# TMS integration rules (avoid wire mistakes)

Source of truth: [handbook notes](./tms-handbook-notes.md) and live spec at `https://fde-challenge-candidate-handbook-production.up.railway.app/spec/`.

## Do

1. **Encode every TMS request** with `bridge/src/tms/commands.ts` — never hand-build `CMD:...|AUTH:...` strings in scripts or the client. Wire field names live in `bridge/src/tms/fields.ts` (`TMS_FIELD`, `TMS_LOAD_STATUS`).
2. **Add or extend** `bridge/test/tms-handbook-fixtures.test.ts` when the handbook adds a transcript or you add a command field.
3. **Run** `npm test` in `bridge/` before merging TMS-related changes.

## Do not

- Invent field names (example bug: `PAYLOAD` on `DEBUG_ECHO` — the handbook uses **`MSG`**).
- Rely on loose success checks (e.g. `AUTH:OK` only); assert the expected response shape from the transcript.

## Command → field map (requests)

| Command | Required | Common optional fields |
| --- | --- | --- |
| `DEBUG_ECHO` | `MSG` | extra pairs echoed in `FIELDS_PARSED` only |
| `LOAD_QUERY` | at least one filter | `ORIG_STATE`, `DEST_STATE`, `ORIG_CITY`, `EQTYPE`, `MAX_RESULTS`, … |
| `LOAD_GET` | `LOAD_ID` | — |
| `LOAD_BOOK` | `LOAD_ID`, `MC_NUM`, `AGREED_RATE` | — |

Parser and fault tests: `bridge/test/tms/parser.test.ts`, `bridge/test/tms/client-faults.test.ts`. Fake TMS: `bridge/src/tms/fake/server.ts`.
