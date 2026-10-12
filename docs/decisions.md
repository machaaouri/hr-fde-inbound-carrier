# Architecture decisions (D1–D8)

This document records implementer decisions for the inbound carrier sales PoC. Source of truth for requirements: `PROBLEM_BRIEF.md`. Workflow export: [`workflow/exports/inbound-carrier-sales-version-2.json`](../workflow/exports/inbound-carrier-sales-version-2.json).

## D1. Bridge API

- **Base path:** `/v1` on HTTPS. **Auth:** `Authorization: Bearer <BRIDGE_API_KEY>` on every route except `GET /health`.
- **Correlation:** optional header `X-HR-Run-Id` (workflow insert `@current.run_id`); logged as `hr_run_id` with `request_id` on each route outcome line, never returned to the agent except via workflow state.
- **Workflow wiring:** URL = `@BRIDGE_BASE_URL` + path; webhook **Bearer Token** = `@BRIDGE_API_KEY` (see `docs/happyrobot-platform-notes.md` Q3).
- **Routes:**
  - `POST /v1/carriers/verify` — `{ mc_number }` → `{ eligible, carrier_name?, dot_number?, reason, contact_email? }`. `contact_email` only when FMCSA returns one; workflow hides it from the agent.
  - `POST /v1/loads/search` — lane/equipment filters → up to 3 loads with **safe fields only** (includes **`loadboard_rate`** from TMS `RATE`; never ceiling / `MAX_BUY`).
  - `POST /v1/offers/decide` — workflow-owned negotiation: Twin `calls` in, `{ agent, calls, offer }` out; never exposes `MAX_BUY`. See [`offers-decide-workflow.md`](./offers-decide-workflow.md).
  - `POST /v1/bookings` — Twin gates + book: `{ load_id, mc_number, agreed_rate, run_id, otp_challenge_status }` → `{ agent, calls }` on **200** (see [`bookings-workflow.md`](./bookings-workflow.md)).
- **Errors:** envelope `{ error: { code, message, retryable, request_id } }`. Codes: `UNAUTHORIZED`, `VALIDATION_ERROR`, `RATE_LIMITED`, `LOAD_NOT_FOUND`, `LOAD_UNAVAILABLE`, `RATE_NOT_ACCEPTABLE`, `CEILING_UNAVAILABLE`, `TMS_UNAVAILABLE`, `TMS_BAD_RESPONSE`, `FMCSA_UNAVAILABLE`, `FMCSA_MISCONFIGURED`, `INTERNAL`. TMS codes are mapped, never passed through.
- **Contract:** frozen in `bridge/openapi.yaml` (step 1). Contract tests enforce it (step 6).

## D2. Negotiation policy

Pure functions in `bridge/src/negotiation/policy.ts`, unit-tested. Detail: [`negotiation-pricing.md`](./negotiation-pricing.md).

**Workflow inputs:** `POST /v1/offers/decide` takes **`offers_history`** (Twin `offers` rows) and **`otp_challenge_status`**. The bridge derives max negotiation round and latest `broker_offer` per load from history; **accept** uses that quote only. Shared parsing: `bridge/src/twin/workflow-fields.ts`.

- **Opening** = TMS posted **loadboard_rate** (`RATE`). If `RATE > MAX_BUY`, open at **max_rate** and log a warning (no ceiling value in logs).
- **Counter ≤ last broker quote** (from history) → **ACCEPT** at the carrier’s number.
- **Close gap** and **counter** rules — see negotiation-pricing.md.
- **Up to 3 counter rounds** (max `round` 0..3 in history); no deal after round 3 → **FINAL_REJECT**.
- **max_rate** (`MAX_BUY`) is used only inside the bridge; HTTP/JSON and logs never expose it.
- **`accept`** (`action: accept`) does not consume a counter round.
- Invalid counter format → **INVALID_COUNTER** (still advances counter round when a counter was attempted).

## D3. Round limit

- **Round limit:** Bridge enforces **3 counter rounds** from max **`round`** in **`offers_history`** for the load; returns `FINAL_REJECT` when exhausted. Workflow **does not** gate rounds with Conditions — it mirrors Twin from `response.calls` and appends `offers` rows.
- **Fixed tool parameters:** `run_id = @current.run_id`; agent supplies only `carrier_counter` on negotiate (raw string). MC, history, and load id for accept come from Twin + fixed webhook mapping.
- **MC change / OTP:** Workflow design and Twin writes govern mid-call MC changes; the bridge only sees `otp_challenge_status` on decide/book.
- **Booking backstop:** ceiling re-check at `POST /v1/bookings` (stateless, no Twin credentials).

Rejected alternative: HMAC negotiation tokens (still needs Twin for replay).

## D4. TMS client

- One TCP connection per request; read until `END\r\n` or `ERR|`; close immediately (handles delayed termination). 4096-byte frame cap.
- Timeouts: connect 800 ms; 2.5 s overall per attempt. Reads: 2 attempts, 200 ms pause. `LOAD_BOOK`: single attempt; reconcile with `LOAD_GET` on uncertainty.
- Parser: split on `KEY:VALUE|`; no field-order assumptions; reject `|`, CR, LF, non-ASCII in encoded values.
- **Requests:** only via `bridge/src/tms/commands.ts`; handbook golden tests in `bridge/test/tms-handbook-fixtures.test.ts` (see `docs/tms-integration.md`).
- Fake TMS (TypeScript) reproduces every documented fault; each fault has a test (step 3).

## D5. Twin data model

System of record; dollars as **bigint** (int8). **MAX_BUY is never stored.**

| Table | Purpose | Writers (Version 2) |
| --- | --- | --- |
| `carrier_contacts` | MC → email on file | seed script; workflow when FMCSA returns email |
| `calls` | per-run state and outcome | workflow tools during the call |
| `otp_challenges` | hashed OTP, attempts, resends | workflow only |
| `offers` | negotiation audit | workflow on each decide tool call |
| `call_events` | append-only audit (optional) | **not written** by current workflow export |

Views: `v_kpi_summary` (§7 KPIs), `v_followups` (rep queue and failures). SQL in `docs/twin/`. See `schema.sql` for columns marked `-- deprecated` when nothing in Version 2 writes them.

## D6. Workflow

- **Export:** [`workflow/exports/inbound-carrier-sales-version-2.json`](../workflow/exports/inbound-carrier-sales-version-2.json) — web call trigger (enhanced security on); inbound voice agent with **7 tools** (`verify_carrier`, `search_loads`, `send_otp`, `verify_otp`, `negotiate`, `accept_offer`, `book_load`).
- **Negotiate / accept:** Read Twin → Webhook (`/v1/offers/decide`) → Write `calls` → Write `offers` (continue on failure); no Condition nodes on negotiation rounds.
- **Other gates:** FMCSA eligibility and OTP success use workflow Conditions / Twin fields as documented in W1–W3.
- Minimal exposed tool results; secrets and ceiling via Fixed values and env-backed headers.
- Call **outcome** is written to Twin during the call via tool paths; there is no separate post-call AI Extract step in Version 2.
- Dev/prod: separate bridge URL and API key; specs in `workflow/W*.md`.

## D7. Stack and deployment

- Node 22, TypeScript strict, Fastify, zod, pino (redaction), vitest, fake TMS in TS, `node:22-slim` Docker image.
- `make deploy` → Cloud Run from `bridge/` with Secret Manager (step 7).
- One `BRIDGE_API_KEY`; in-memory rate limit per IP (`@fastify/rate-limit`).
- CI: lint, typecheck, test, Docker build on push.

## D8. OTP (bridge + platform delivery)

**User choice:** all OTP crypto in TypeScript on the bridge; no Custom Code nodes.

- After FMCSA pass: contact from Twin seed first, then FMCSA email if `OTP_FMCSA_FALLBACK=on` (production only). Workflow resolves email via Read Twin before calling the bridge.
- **`POST /v1/otp/send`** — bridge generates 6-digit code, salt, SHA-256 hash, expiry; returns fields for **Write Twin** (`otp_challenges`) and a hidden **`otp_code`** for **Send Email** (To = email from Twin, fixed in workflow).
- **`POST /v1/otp/verify`** — workflow Read Twin passes hash/salt/expiry/attempts + caller code; bridge verifies; response is `{ result, attempts, attempts_left }`. Bridge does not connect to Twin.
- Limits: 5 min TTL, max 3 verify attempts, max 2 resends (resend replaces challenge). Constant-time compare in `bridge/src/otp/`.
- Residual risk: `otp_code` visible in run details (webhook + email node inputs) to platform users with run access—not in agent context.

## Resolved requirements (summary)

1. Missing MAX_BUY → `CEILING_UNAVAILABLE` / outcome `system_error`.
2. OTP for every FMCSA pass (stricter than PDF ambiguity).
3. Margin KPI vs ceiling dropped; report agreed vs loadboard only.
4. Invalid counters count as a round.
5. FMCSA: `allowedToOperate=Y`, `oosDate` null, common or contract authority **`A`** (docket or `/authority`); bad webKey → `FMCSA_MISCONFIGURED`; unreachable/geo → `FMCSA_UNAVAILABLE`. Live MC **784219** → `NOT_AUTHORIZED`.
6. No INVALID_RATE probing from bridge.
7. Booked without ref → `booked`, follow-up row.
8. Abandoned before MC: Twin row may be platform-only (unverified).
9. Ops App auth: confirm org user in sandbox; fallback shared secret.
10. E2E tests: org members signed in (enhanced security).
