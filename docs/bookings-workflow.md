# Bookings workflow (`POST /v1/bookings`)

Same pattern as [`offers-decide-workflow.md`](./offers-decide-workflow.md): **HTTP 200** with `{ agent, calls }` for all business outcomes. Only TMS transport/parser failures use **502/504** error envelopes.

## Request

| Field | Source |
| --- | --- |
| `load_id` | Twin `calls.current_load_id` |
| `mc_number` | Twin `calls.mc_number` |
| `agreed_rate` | Twin `calls.agreed_rate` (integer or numeric string) |
| `run_id` | `@current.run_id` |
| `outcome` | Twin `calls.outcome` |
| `otp_status` | Legacy Twin `calls.otp_status` |
| `otp_challenge_status` | **Preferred** — Twin `otp_challenges.status` (`passed` required to book) |

When both OTP fields are sent, **`otp_challenge_status` wins** (legacy disagreements are logged).

### Example — legacy (Version 2)

```json
{
  "load_id": "LD0000045821",
  "mc_number": "136818",
  "agreed_rate": 1900,
  "run_id": "…",
  "otp_status": "passed",
  "outcome": "agreed"
}
```

### Example — source verification

```json
{
  "load_id": "LD0000045821",
  "mc_number": "136818",
  "agreed_rate": 1900,
  "run_id": "…",
  "otp_challenge_status": "passed",
  "outcome": "agreed"
}
```

## Bridge rules

| Condition | `agent.status` | TMS |
| --- | --- | --- |
| Verification ≠ `passed` or `outcome` ≠ `agreed` or empty `agreed_rate` | `NOT_READY` | No call |
| `agreed_rate` > ceiling | `RATE_NOT_ACCEPTABLE` | No book |
| Load not OPEN / booked by other party | `LOAD_UNAVAILABLE` | Reconcile when non-OPEN |
| `LOAD_BOOK` success | `BOOKED` | `booking_ref` set |
| Duplicate / uncertain + GET shows our ref | `BOOKED_RECONCILED` | `booking_ref` set |
| Timeout + GET still OPEN | `NOT_BOOKED` | Outcome unchanged |

## Response 200

```json
{
  "agent": { "status": "BOOKED", "booking_ref": "BR-…" },
  "calls": { "booking_ref": "BR-…", "outcome": "booked" }
}
```

On non-success business statuses, `calls.outcome` stays the **incoming** value; `booking_ref` is null.

## Workflow steps

1. **Read Twin** — `calls` (+ optional `otp_challenges` for source verification)  
2. **Webhook** — `POST /v1/bookings`  
3. **Write Twin** — upsert `calls` from **`response.calls`**  
4. Agent reads **`response.agent`** only

## HTTP errors

| Code | When |
| --- | --- |
| **401** | Bad Bearer |
| **422** | Malformed body |
| **502/504** | TMS fault |
