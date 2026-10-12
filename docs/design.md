# Inbound carrier bridge — design (current)

Authoritative HTTP contract: [`bridge/openapi.yaml`](../bridge/openapi.yaml). Workflow export: [`workflow/exports/inbound-carrier-sales-version-4.json`](../workflow/exports/inbound-carrier-sales-version-4.json).

## Auth & correlation

- **Bearer** `Authorization` on every route except `GET /health`.
- Optional **`X-HR-Run-Id`** → logged as `hr_run_id` with `request_id` on one **route outcome** line per request (never echoed to the agent).

## API summary

### `GET /health`

`{ "status": "ok" }` — no auth.

### `POST /v1/carriers/verify`

**In:** `{ "mc_number": string }`  
**Out (200):** `{ eligible, reason, carrier_name?, dot_number?, contact_email? }` — hide `contact_email` from the agent.  
**503:** `FMCSA_UNAVAILABLE`, `FMCSA_MISCONFIGURED`.

### `POST /v1/loads/search`

**In:** `equipment_type` (required), optional lane fields.  
**Out:** up to 3 loads with **safe fields** including `loadboard_rate` (TMS `RATE`). **Never** `MAX_BUY` / ceiling.

### `POST /v1/offers/decide`

Workflow-owned negotiation. **In:**

| Field | Notes |
| --- | --- |
| `action` | `negotiate` or `accept` |
| `load_id` | Load the carrier chose |
| `carrier_counter` | Raw string; `""` = opening or accept branch |
| `current_load_id` | Twin active load or `""` |
| `otp_challenge_status` | Twin `otp_challenges.status` (`passed` for TMS) |
| `offers_history` | Twin `offers` rows (array or JSON string; may be `[]`) |

**Out (200):** `{ agent, calls, offer }`

- **`agent`:** `decision`, `broker_offer`, `agreed_rate`, `rounds_remaining`
- **`calls`:** patch only (`current_load_id`, `agreed_rate`, `outcome` when set)
- **`offer`:** row to append to Twin `offers`, or `null`

**Accept:** no price in request. If history already has **ACCEPT** for the load → idempotent (same `agreed_rate`, empty `calls`, no `offer`). Else accepts **latest `broker_offer`** in history (≤ ceiling). Every new **ACCEPT** `offer` stores agreed price in **`broker_offer`**.

**Decisions:** `OPENING`, `COUNTER`, `ACCEPT`, `FINAL_REJECT`, `INVALID_COUNTER`, `LOAD_UNAVAILABLE`, `NOT_VERIFIED`, `NO_OFFER`.

### `POST /v1/bookings`

**In:** `{ load_id, mc_number, agreed_rate, run_id, otp_challenge_status }`  
**Out (200):** `{ agent: { status, booking_ref }, calls }` — `calls` empty unless booked (`booking_ref`, `outcome: booked`).

**Statuses:** `NOT_READY`, `RATE_NOT_ACCEPTABLE`, `LOAD_UNAVAILABLE`, `NOT_BOOKED`, `BOOKED`, `BOOKED_RECONCILED`.

### OTP

**`POST /v1/otp/send`** — `{ run_id, mc_number, email, resends, is_resend? }` → hash, salt, expiry, hidden `otp_code` for email node.  
**`POST /v1/otp/verify`** — `{ run_id, code, code_hash, salt, expires_at, attempts }` → `{ result, attempts, attempts_left }`.

Limits: 5 min TTL, 3 verify attempts, 2 resends. Constant-time compare; pino redacts codes/hashes/salts.

## Negotiation policy (pure functions in `bridge/src/offers/policy.ts`)

1. **Opening** = TMS posted rate; if above ceiling, open at ceiling (warn in logs without printing ceiling).
2. Counter ≤ last broker quote → **ACCEPT** at carrier number.
3. **Close gap:** within max($50, 3% of last quote) and ≤ ceiling → **ACCEPT**.
4. Else broker moves toward carrier (~50% / 65% / 75% of gap by round), $5 or $25 steps, soft cap below ceiling so the max is not probeable.
5. Max **3 counter rounds** (max `round` in `offers_history`); round 3 + counter → **FINAL_REJECT**.
6. Ceiling used only inside bridge — never in JSON or logs.

Example (handbook load **LD0000045821**): loadboard $2,150, ceiling $1,950 → opening **$1,950**; carrier **$2,200** → counter **$1,900** (soft cap, not half-gap).

## Booking / TMS

- Stateless: re-check ceiling on book; accept `PENDING` + booking ref from TMS when wire returns it.
- TCP TMS: one connection per request, `KEY:VALUE|` frames, timeouts/retries per client.
- Errors map to `TMS_UNAVAILABLE`, `TMS_BAD_RESPONSE`, etc. — never raw TMS codes.

## Twin (Version 4)

**Tables:** `carrier_contacts`, `calls`, `otp_challenges`, `offers`.

**`calls` columns:** `run_id`, `env`, `started_at`, `ended_at`, `mc_number`, `carrier_name`, `dot_number`, `fmcsa_eligible`, `fmcsa_reason`, `current_load_id`, `agreed_rate`, `outcome`, `booking_ref`, `notes`.

OTP verification and negotiation rounds are **not** duplicated on `calls` (use `otp_challenges` and `offers`).

**Post-call (Version 4):** after the voice session ends, workflow steps **`generate_call_notes`** (AI summary) and **`write_call_notes`** (Twin write) set **`calls.notes`** and **`calls.ended_at`**.

**Upgrade from older Twin:** run once in the Twin SQL console (backup first), then re-run [`twin/views.sql`](twin/views.sql):

```sql
DROP VIEW IF EXISTS v_followups;
DROP VIEW IF EXISTS v_kpi_summary;

ALTER TABLE calls DROP COLUMN IF EXISTS mc_locked;
ALTER TABLE calls DROP COLUMN IF EXISTS fmcsa_status;
ALTER TABLE calls DROP COLUMN IF EXISTS otp_status;
ALTER TABLE calls DROP COLUMN IF EXISTS rounds_used;
ALTER TABLE calls DROP COLUMN IF EXISTS standing_offer;
ALTER TABLE calls DROP COLUMN IF EXISTS loadboard_rate;
ALTER TABLE calls DROP COLUMN IF EXISTS outcome_reason;
ALTER TABLE calls DROP COLUMN IF EXISTS handoff_status;
ALTER TABLE calls DROP COLUMN IF EXISTS summary;
ALTER TABLE calls DROP COLUMN IF EXISTS run_url;

DROP INDEX IF EXISTS idx_events_run;
DROP TABLE IF EXISTS call_events;

CREATE INDEX IF NOT EXISTS idx_offers_run_load_round ON offers (run_id, load_id, round);
```

**Views:** `v_kpi_summary` uses `fmcsa_eligible`, `otp_challenges.status`, and `offers` for rounds/opening rate; `v_followups` queues booking/OTP/system failures.

## Key decisions

- Workflow owns Twin writes; bridge is stateless and has no DB credentials.
- Version 4: **6 tools** (`verify_carrier`, `search_loads`, `send_otp`, `verify_otp`, `negotiate`, `book_load`); accept via `negotiate` + `action: "accept"`.
- FMCSA: authority **A** required; insurance not gated in bridge yet.
- Logging: one outcome line per request; redact secrets and ceiling fields.
