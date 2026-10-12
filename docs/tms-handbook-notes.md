# Legacy TMS protocol handbook notes

Source: [HappyRobot Legacy TMS Protocol Reference](https://fde-challenge-candidate-handbook-production.up.railway.app/spec/) (login `POST /__login` with candidate password). Re-fetch with cookie jar (`curl -c/-b`).

This file captures protocol rules and **sample transcripts** used as parser/fixture references (see D4, step 3).

## Transport

| Property | Value |
| --- | --- |
| Transport | TCP |
| Encoding | ASCII |
| Line terminator | `\r\n` |
| Max frame | 4096 bytes (including terminator) |
| Idle timeout | 30 s (server close) |
| Lifecycle | **One request per connection** |

Server closes after response. Open a new connection per request.

## Request

Single line: `CMD:<cmd>|AUTH:<token>|<FIELD>:<VALUE>|...\r\n`

- `CMD` first; `AUTH` required on every request.
- Values must not contain `|` or `\r\n`.
- Unknown fields discarded.

## Response

**Success:** zero or more record lines, then `END\r\n`.

**Error:** `ERR|CODE:<code>|MSG:<msg>\r\n`

Field values may be fixed-width, space-padded right. Widths: derive from transcripts.

## Commands

| Command | Purpose |
| --- | --- |
| `LOAD_QUERY` | Search open board |
| `LOAD_GET` | Full load record |
| `LOAD_BOOK` | Commit booking (success → `STATUS:BOOKED`) |

### Load `STATUS` (bookability)

Only **`OPEN`** loads are bookable. Filter with `isBookableLoad()` (`bridge/src/loads/tms-record.ts`).

| STATUS | Bookable |
| --- | --- |
| `OPEN` | Yes |
| `BOOKED` | No — already taken |
| `PENDING` | No — held / in-flight (often after a book attempt); see [`tms-load-status-report.md`](./tms-load-status-report.md) |
| Other | No |

Search, offers/decide, and bookings all use this rule.
| `DEBUG_ECHO` | Diagnostic; **bypasses fault injection** |

Error codes seen in practice: `AUTH_FAILED`, `UNKNOWN_CMD`, `MISSING_FIELD`, `UNKNOWN_LOAD`, `ALREADY_BOOKED`, `INVALID_RATE`, `MALFORMED`, `SERVER_ERROR` (non-exhaustive).

## Fault behavior (non-prod)

Not signaled on the wire. Categories:

- **Timeout** — no response until idle close
- **Partial response** — no `END`
- **Malformed** — extra delimiters, bad widths, unterminated lines
- **Delayed termination** — full response then held connection

`DEBUG_ECHO` does not traverse fault injection.

## LOAD_QUERY

At least one filter beyond `CMD`/`AUTH`. Common fields: `ORIG_STATE`, `DEST_STATE`, `ORIG_CITY`, `EQTYPE`, pickup date; `MAX_RESULTS` caps results.

### Transcript 1 — state + equipment

```text
> CMD:LOAD_QUERY|AUTH:t-9c3a...|ORIG_STATE:GA|DEST_STATE:TX|EQTYPE:DRY_VAN|MAX_RESULTS:5

< LOAD_ID:LD0000045821|ORIG_CITY:Atlanta                       |ORIG_STATE:GA|ORIG_ZIP:30303|DEST_CITY:Dallas                        |DEST_STATE:TX|DEST_ZIP:75201|PICKUP_DT:20260512080000|EQTYPE:DRY_VAN   |RATE:0002150|MILES:000785|STATUS:OPEN
< LOAD_ID:LD0000045903|ORIG_CITY:Atlanta                       |ORIG_STATE:GA|ORIG_ZIP:30303|DEST_CITY:Houston                       |DEST_STATE:TX|DEST_ZIP:77002|PICKUP_DT:20260513140000|EQTYPE:DRY_VAN   |RATE:0002280|MILES:000789|STATUS:OPEN
< END
```

### Transcript 2 — city + reefer

```text
> CMD:LOAD_QUERY|AUTH:t-9c3a...|ORIG_CITY:Miami|EQTYPE:REEFER|MAX_RESULTS:3

< LOAD_ID:LD0000046112|ORIG_CITY:Miami                         |ORIG_STATE:FL|ORIG_ZIP:33101|DEST_CITY:Newark                        |DEST_STATE:NJ|DEST_ZIP:07102|PICKUP_DT:20260514063000|EQTYPE:REEFER    |RATE:0003420|MILES:001280|STATUS:OPEN
< LOAD_ID:LD0000046188|ORIG_CITY:Miami Gardens                 |ORIG_STATE:FL|ORIG_ZIP:33056|DEST_CITY:Charlotte                     |DEST_STATE:NC|DEST_ZIP:28202|PICKUP_DT:20260515110000|EQTYPE:REEFER    |RATE:0001980|MILES:000711|STATUS:OPEN
< END
```

### Transcript 3 — empty

```text
> CMD:LOAD_QUERY|AUTH:t-9c3a...|ORIG_CITY:Boise|DEST_STATE:VT|EQTYPE:REEFER

< END
```

### Transcript 4 — missing filter

```text
> CMD:LOAD_QUERY|AUTH:t-9c3a...

< ERR|CODE:MISSING_FIELD|MSG:at least one filter required
```

Notes: city matching forgiving; state/ZIP exact; unknown `EQTYPE` → no error, no rows.

## LOAD_GET

Returns full record including schedule, cargo, notes, pricing. **MAX_BUY** appears only for flagged tokens.

### Transcript 1 — dry van (note MAX_BUY below RATE)

```text
> CMD:LOAD_GET|AUTH:t-9c3a...|LOAD_ID:LD0000045821

< LOAD_ID:LD0000045821|ORIG_CITY:Atlanta                       |ORIG_STATE:GA|ORIG_ZIP:30303|DEST_CITY:Dallas                        |DEST_STATE:TX|DEST_ZIP:75201|PICKUP_DT:20260512080000|DELIVERY_DT:20260513170000|EQTYPE:DRY_VAN   |RATE:0002150|WEIGHT:0042000|COMMODITY:PALLETIZED CONSUMER GOODS       |PIECES:000026|MILES:000785|DIMS:48X40 STD GMA PALLETS              |NOTES:Drop trailer at destination. Appt required.                                                                       |STATUS:OPEN    |MAX_BUY:0001950
< END
```

### Transcript 2 — reefer

```text
> CMD:LOAD_GET|AUTH:t-9c3a...|LOAD_ID:LD0000046112

< LOAD_ID:LD0000046112|ORIG_CITY:Miami                         |ORIG_STATE:FL|ORIG_ZIP:33101|DEST_CITY:Newark                        |DEST_STATE:NJ|DEST_ZIP:07102|PICKUP_DT:20260514063000|DELIVERY_DT:20260516120000|EQTYPE:REEFER    |RATE:0003420|WEIGHT:0038500|COMMODITY:FRESH PRODUCE - MIXED           |PIECES:000022|MILES:001280|DIMS:48X40 CHEP PALLETS                 |NOTES:Reefer set 34F continuous. Pre-cool trailer. Live unload. 2H detention free, then $75/h.
< END
```

## LOAD_BOOK

Fields: `LOAD_ID`, `MC_NUM`, `AGREED_RATE`. Success includes `BOOKING_REF` and a timestamp `YYYYMMDDHHMMSS`. The handbook transcript shows `STATUS:BOOKED`; **live TMS often returns `STATUS:PENDING`** on the book wire while still issuing `BOOKING_REF` (token-scoped hold). Repeat → `ALREADY_BOOKED` (*by this token* when applicable); rate 0 → `INVALID_RATE`.

## DEBUG_ECHO

Diagnostic round-trip; bypasses fault injection. Echo field is **`MSG`**, not `PAYLOAD`.

```text
> CMD:DEBUG_ECHO|AUTH:t-9c3a...|MSG:HELLO

< ECHO|AUTH:OK|FIELDS_PARSED:3|MSG:HELLO
< END
```

```text
> CMD:DEBUG_ECHO|AUTH:bogus|MSG:HELLO

< ERR|CODE:AUTH_FAILED|MSG:invalid or missing auth token
```

## Runtime configuration

`TMS_HOST`, `TMS_PORT`, `TMS_TOKEN` from env only (candidate portal). Never commit tokens.

Probe results for this repo: `docs/archive/tms-probe-results.json` (`make probe-tms`).
