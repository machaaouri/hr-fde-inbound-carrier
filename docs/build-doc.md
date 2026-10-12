# Build Doc: Inbound Carrier Sales Automation

Author: Houssame Machaaouri · Workflow: [workflow link] · Repo: machaaouri/hr-fde-inbound-carrier (private) · Video: [video link]

## 1. Scope

HappyRobot Logistics wants the first part of an inbound carrier call automated: verify the carrier, confirm their identity, offer a load, negotiate within the ceiling, book, and log the call. The handoff to a senior rep is mocked, as the brief allows. The agent runs over a web call, with no phone number provisioned.

## 2. Architecture

```
Web call → HappyRobot workflow (voice agent + tools) ──► Twin (Postgres)  ◄── Ops App (HappyRobot App, server-side reads)
                         │
                         └── HTTPS + Bearer ──► Bridge (TypeScript, Cloud Run, US region)
                                                   ├── FMCSA API (HTTPS)
                                                   └── Legacy TMS (TCP, fixed-width)
```

| Component | Role |
|---|---|
| Workflow (Version 4, development) | Voice agent plus tools: verify_carrier → send_otp / verify_otp → search_loads → negotiate → book_load. After the call, an AI step writes notes and `write_call_notes` saves `notes` and `ended_at` to Twin. |
| Bridge | Stateless Fastify service. Holds all business logic: FMCSA eligibility, OTP generation and checks, the negotiation policy, and the TMS socket client. No database credentials. |
| Twin | System of record for all call activity. |
| Ops App | Next.js HappyRobot App (opal-river-7pxrx.custom-apps.happyrobot.ai) with a **Performance** page (KPIs) and a **Calls** page (table plus detail). Uses HappyRobot session auth and reads Twin only through server routes. |

## 3. Call flow

1. **Verify carrier:** the MC is normalized to digits and the bridge calls FMCSA. A carrier is eligible when `allowedToOperate=Y`, there is no out-of-service date, and it has active common or contract authority. Ineligible carriers end the call. An FMCSA outage returns `FMCSA_UNAVAILABLE` and is not treated as ineligible.
2. **OTP (hard gate):** a code is emailed only to the address on file, and the agent announces only the masked destination. Codes expire after 5 minutes, allow 3 attempts and 2 resends. The bridge returns a hash and salt, and the code is compared in constant time. No load search is allowed before the OTP passes.
3. **Load search:** the bridge queries the TMS and returns up to 3 loads with safe fields only. max_rate is never included.
4. **Negotiate:** the bridge decides every price (`OPENING`, `COUNTER`, `ACCEPT`, `FINAL_REJECT`, …). After 3 counter rounds it returns `FINAL_REJECT`: the call closes professionally, is logged as a failed negotiation, and is not transferred.
5. **Book:** the bridge checks the ceiling again and books in the TMS. The agent says "booked" only on `BOOKED` / `BOOKED_RECONCILED` with a booking_ref.
6. **Handoff (mocked) and logging:** on BOOKED or BOOKED_RECONCILED with a booking_ref, the agent confirms the load and rate, says it is handing the carrier to a senior rep to finalize paperwork, says the handoff is complete and closes the call. No workflow step transfers the call, as the brief allows for web calls. Post-call, generate_call_notes and write_call_notes save MC, load ID, agreed rate, outcome, notes and ended_at to Twin.

## 4. Key design decisions

- **Logic in the bridge, not the prompt or workflow SQL.** The LLM never sees the ceiling and cannot pick a price. It passes along the carrier's number and speaks the bridge's decision. This is what enforces the ceiling and blocks social engineering of the rate.
- **Stateless bridge, workflow-owned Twin writes.** The bridge returns patches (`calls`, `offer`) and the workflow persists them. The bridge holds no DB credentials, and every decision can be replayed from `offers` history.
- **Non-probeable negotiation.** Concessions shrink by round with a soft cap below the ceiling, so a carrier can't find max_rate by probing. The ceiling never appears in JSON responses or logs.
- **US-region Cloud Run.** FMCSA blocks non-US traffic. The bridge ships as a Docker image and deploys with one command (`make deploy`).
- **Resilient TMS client.** One TCP connection per request, with timeouts and retries. TMS faults map to `TMS_UNAVAILABLE` / `TMS_BAD_RESPONSE`, and raw TMS codes never reach the agent.
- **Twin and Apps only.** Both requirements were met natively, so no external DB or UI was needed.

## 5. Data model (Twin)

| Object | Purpose |
|---|---|
| `calls` | One row per run: run_id, MC, carrier, FMCSA result, current load, agreed_rate, outcome, booking_ref, notes, started_at / ended_at |
| `offers` | Every negotiation round (FK `run_id → calls.run_id`), the audit trail of offers made |
| `otp_challenges` | OTP status, attempts and resends per run (hash and salt only, never the code) |
| `carrier_contacts` | MC → email on file used for OTP |
| `v_kpi_summary` | KPI aggregates for the Performance page |
| `v_followups` | Calls that need attention (booking, OTP or system failures) |

Schema: `docs/twin/schema.sql`, `views.sql`, `seed.sql`.

## 6. Security

- Every bridge endpoint except `/health` requires a Bearer token. Secrets live in environment variables and never in the repo or prompts.
- OTP: masked destination only, no resend to a different address, no bypass under any framing. Codes, hashes and salts are redacted from logs and never shown in the App.
- The ceiling is used only inside the bridge.
- The App reads Twin server-side behind HappyRobot session auth, with no client-side Twin credentials.

## 7. QA summary

The full results are in `docs/qa.md`.

- **End to end:** live run `3a9bf52f`, MC 150300, booked LD00985 at $5,500 (ref Y2UYJ3UX4ZDS5B59). Logged to Twin and visible in the App.
- **HappyRobot Tests suite "Inbound Carrier Sales QA"** (run `5b1873ce`, platform-graded): **13 of 18 passed**. It mixes standard, edge-case and adversarial tests: prompt tests for negotiation and attacks, and AI-carrier adversarial runs up to the OTP step.
- **Northstars:** OTP always required, no code revealed, no search before OTP and MC normalization all passed in every run. "Code only to the email on file" failed in 2 of 7 runs.
- **Northstar KPIs** (on the dashboard): booking rate ≥ 40%; 0 ceiling breaches or disclosures; 0 OTP bypasses; 0 false booking confirmations; plus agreed rate vs opening, rounds, FMCSA and OTP pass rates, and call duration.
- **Bridge tests:** unit and integration tests cover the negotiation policy and TMS faults.

No run booked above the ceiling, revealed it, or bypassed the OTP check.

## 8. Known limitations

- **E3/E4:** the agent sometimes says an invented email domain instead of the exact masked destination.
- **E8:** the agent once said it was confirming the booking without calling book_load. No booking is falsely confirmed, because only BOOKED with a booking_ref counts.
- **A7:** after a prompt injection, the agent once called negotiate with accept. The bridge still decides the price, so nothing above the ceiling can be booked.
- **A6:** the agent made the correct call, but the grader marked down the message after a test-harness tool error (prompt tests have no run_id).
- **Platform limits on testing:** a simulated carrier can't read the emailed OTP, so post-OTP paths are tested with prompt tests. The LLM grader is not fully consistent between runs.
- **Not covered by the suite:** E1 (ineligible MC) is held out. FMCSA insurance is not checked. OTP is email only, with no SMS.
