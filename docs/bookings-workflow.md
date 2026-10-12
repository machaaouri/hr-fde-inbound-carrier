# Bookings workflow (`POST /v1/bookings`)

Same pattern as [`offers-decide-workflow.md`](./offers-decide-workflow.md): **HTTP 200** with `{ agent, calls }` for all business outcomes. Only TMS transport/parser failures use **502/504** error envelopes.

## Request

| Field | Source |
| --- | --- |
| `load_id` | Twin `calls.current_load_id` |
| `mc_number` | Twin `calls.mc_number` |
| `agreed_rate` | Twin `calls.agreed_rate` (integer or numeric string) |
| `run_id` | `@current.run_id` |
| `otp_challenge_status` | Twin `otp_challenges.status` (`passed` required to book) |

### Example

```json
{
  "load_id": "LD0000045821",
  "mc_number": "136818",
  "agreed_rate": 1900,
  "run_id": "…",
  "otp_challenge_status": "passed"
}
```

## Bridge rules

| Condition | `agent.status` | TMS |
| --- | --- | --- |
| `otp_challenge_status` ≠ `passed` or empty `agreed_rate` | `NOT_READY` | No call |
| `agreed_rate` > ceiling | `RATE_NOT_ACCEPTABLE` | No book |
| Load not OPEN / booked by other party | `LOAD_UNAVAILABLE` | Reconcile when non-OPEN |
| `LOAD_BOOK` success | `BOOKED` | `booking_ref` set |
| Duplicate / uncertain + GET shows our ref | `BOOKED_RECONCILED` | `booking_ref` set |
| Timeout + GET still OPEN | `NOT_BOOKED` | No `calls` patch |

## Response 200

```json
{
  "agent": { "status": "BOOKED", "booking_ref": "BR-…" },
  "calls": { "booking_ref": "BR-…", "outcome": "booked" }
}
```

On non-success business statuses, `calls` is **`{}`**.

## Workflow steps

1. **Read Twin** — `calls`, `otp_challenges`  
2. **Webhook** — `POST /v1/bookings`  
3. **Write Twin** — merge **`response.calls`** into `calls`  
4. Agent reads **`response.agent`** only

## HTTP errors

| Code | When |
| --- | --- |
| **401** | Bad Bearer |
| **422** | Malformed body |
| **502/504** | TMS fault |
