# Bookings workflow (`POST /v1/bookings`)

Same pattern as [`offers-decide-workflow.md`](./offers-decide-workflow.md): **HTTP 200** with `{ agent, calls }` for all business outcomes. Only TMS transport/parser failures use **502/504** error envelopes.

## Request (always send Twin fields)

| Field | Source |
| --- | --- |
| `load_id` | Twin `calls.current_load_id` |
| `mc_number` | Twin `calls.mc_number` |
| `agreed_rate` | Twin `calls.agreed_rate` (integer or numeric string) |
| `run_id` | `@current.run_id` |
| `otp_status` | Twin `calls.otp_status` |
| `outcome` | Twin `calls.outcome` |

## Bridge rules

| Condition | `agent.status` | TMS |
| --- | --- | --- |
| `otp_status` ≠ `passed` or `outcome` ≠ `agreed` or empty `agreed_rate` | `NOT_READY` | No call |
| `agreed_rate` > ceiling | `RATE_NOT_ACCEPTABLE` | No book (ceiling never in JSON) |
| Load not OPEN / booked by other party | `LOAD_UNAVAILABLE` | Reconcile only when already non-OPEN |
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

1. **Read Twin** — `calls` for book fields  
2. **Webhook** — `POST /v1/bookings`  
3. **Write Twin** — upsert `calls` from **`response.calls`**  
4. Agent reads **`response.agent`** only (`status`, `booking_ref`)

## HTTP errors (no branch on these in happy path)

| Code | When |
| --- | --- |
| **401** | Bad Bearer |
| **422** | Malformed body (missing required keys) |
| **502** | TMS bad response |
| **504** | TMS timeout (retry; may reconcile on a later 200) |

## Tests

`bridge/test/bookings.test.ts` — each `agent.status`, duplicate reconcile, timeout **504**, numeric string rate.
