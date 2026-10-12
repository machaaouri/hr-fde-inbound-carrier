# TMS load STATUS — report (LD00923 / PENDING)

## Handbook & PoC rule

The candidate TMS handbook documents **`OPEN`** on `LOAD_QUERY` / `LOAD_GET` rows and **`BOOKED`** after a successful **`LOAD_BOOK`**. It does **not** define every status string in the repo transcripts; live TMS also returns **`PENDING`**.

**Bridge rule (shared everywhere):** a load is **bookable** iff `STATUS` (trimmed) is **`OPEN`**.  
Anything else — including **`PENDING`**, **`BOOKED`**, missing/unknown status — is **not** bookable and must not be pitched or negotiated.

| STATUS (typical) | Bookable? | Meaning in this PoC |
| --- | --- | --- |
| **OPEN** | Yes | Available for quote and `LOAD_BOOK` |
| **BOOKED** | No | Committed (yours or another token’s booking) |
| **PENDING** | No | Held / in-flight (see below) |
| Other / empty | No | Treat as unavailable |

Implementation: `isBookableLoad()` in `bridge/src/loads/tms-record.ts`.

## Booking bug (fixed)

Live **`LOAD_BOOK`** can return **`STATUS:PENDING`** with a valid **`BOOKING_REF`** (token hold). The bridge previously required **`BOOKED`** on the wire and then **`LOAD_UNAVAILABLE`** on reconcile. See [`archive/tms-pending-booking-root-cause.md`](./archive/tms-pending-booking-root-cause.md).

## Why LD00923 is **PENDING**

Live **`LOAD_GET`** for **`LD00923`** (2026-10-11):

- `STATUS`: **PENDING**
- `RATE`: 821, `MAX_BUY`: 879
- No `BOOKING_REF` on GET

**Likely cause:** an earlier **`LOAD_BOOK`** (or TMS-side hold) moved the load off **OPEN** without leaving a final **BOOKED** + ref on the GET snapshot you see — consistent with a **tentative / in-progress booking** state. The load was probably **OPEN** when it first appeared in **`LOAD_QUERY`**, which is why an older **`search_loads`** could pitch it before status changed.

After the shared rule:

- **`/v1/loads/search`** — PENDING rows dropped (same as BOOKED).
- **`/v1/offers/decide`** — **`LOAD_UNAVAILABLE`** on **`LOAD_GET`** before rate/ceiling logic.
- **`/v1/bookings`** — unchanged path; non-OPEN → **`LOAD_UNAVAILABLE`**.

## Tests

`bridge/test/load-bookable-status.test.ts` — fake **LD000009923** (PENDING) vs **LD000009924** (OPEN) on AL→MO search, decide, and book.
