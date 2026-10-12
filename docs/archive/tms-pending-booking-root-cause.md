# Root cause: negotiate → book returned `LOAD_UNAVAILABLE`

## Trace (live TMS, 2026-10-11)

| Step | TMS command | STATUS after step |
| --- | --- | --- |
| Search / baseline | `LOAD_GET` | **OPEN** |
| Decide opening | bridge → `LOAD_GET` only | **OPEN** |
| Decide counter / accept | bridge → `LOAD_GET` only | **OPEN** |
| Book | bridge → `LOAD_BOOK` | **PENDING** on GET (no ref on GET yet) |

**Hypothesis rejected:** `/v1/offers/decide` does not change STATUS; only `LOAD_GET` on the bridge path. Repeated `LOAD_GET` alone does not flip OPEN → PENDING.

**Root cause:** Live **`LOAD_BOOK`** success responses use **`STATUS:PENDING`** (not `BOOKED`) while still returning a valid **`BOOKING_REF`**. Bookings are keyed to the TMS token ([`PROBLEM_BRIEF.md`](../PROBLEM_BRIEF.md) §6). A repeat `LOAD_BOOK` returns `ALREADY_BOOKED` with message *Already booked by this token*.

The bridge required `STATUS:BOOKED` on the book wire → `TMS_BAD_RESPONSE` → reconcile via `LOAD_GET` saw **PENDING** without `BOOKING_REF` → **`LOAD_UNAVAILABLE`**, even though the first `LOAD_BOOK` had already committed the hold for this token.

## Handbook rule applied

- **`LOAD_BOOK`** success includes **`BOOKING_REF`**; bookings are **keyed to the token**.
- **`PENDING`** on GET means an in-flight / token-held booking, not “someone else took it.”
- Pitch/search stay **OPEN-only**; **book** accepts the book wire when **`BOOKING_REF`** is present and STATUS is **`BOOKED` or `PENDING`**. Reconcile treats **PENDING + ref** like **BOOKED**.

## Fix

`bridge/src/bookings/submit-load-book.ts` — treat `PENDING` + `BOOKING_REF` as success.  
`bridge/src/bookings/create-booking-service.ts` — reconcile **PENDING** when `BOOKING_REF` is on the GET record.

## Verification

After deploy, negotiate → accept → book against the bridge should end in **`BOOKED`** with a wire `BOOKING_REF`. See `bridge/test/negotiate-then-book.test.ts` and live booking fixes in `submit-load-book.ts`.
