# Bridge TMS resilience (502/503 via ngrok)

## Symptoms

- `POST /v1/offers/decide` with a non-existent `load_id` caused ngrok **502/503** (backend down).
- Repeated `POST /v1/loads/search` (e.g. AL→MO dry van) through the tunnel sometimes killed the process even when the same search worked locally.

## Root cause

1. **Load search used extra `LOAD_GET`s per QUERY hit** (earlier, in parallel) against a single-threaded TMS TCP server. That was never required for the workflow—only the carrier’s chosen `load_id` needs GET (decide/book). Bursts of concurrent sockets increased timeouts and partial reads.
2. **TCP client lifecycle**: sockets could retain listeners or reject after `END` without a single `finish()` path, contributing to unhandled rejections under load.
3. **Unknown load on decide** could crash the process instead of returning a typed outcome; today decide returns **200** with `agent.decision: LOAD_UNAVAILABLE` (workflow does not HTTP-branch on load state).
4. **Ngrok 502/503** often means the bridge exited or hung (e.g. dev reload after crash), not a TMS-specific HTTP status from the handbook.

## Changes

| Area | Behavior |
|------|----------|
| `searchLoads` | **`LOAD_QUERY` only** (up to 3 OPEN/future rows); `loadboard_rate` from QUERY `RATE`; no GET until decide on chosen `load_id`. |
| `fetchLoadRecord` / `fetchLoadPricing` | Shared GET path; `UNKNOWN_LOAD` → 404; pricing uses `MAX_BUY` internally only. |
| `TmsClient` | Timeouts → **504** `TMS_UNAVAILABLE` (`retryable: true`); malformed/partial frames → **502** `TMS_BAD_RESPONSE`; `removeAllListeners` + destroy on finish. |
| `build-app` | Fastify error handler returns handbook-shaped envelopes with `request_id`; retryable TMS failures logged at warn with `request_id`. |
| `index.ts` | Log `unhandledRejection` / `uncaughtException` without exiting (dev stability). |

## Verification

- `bridge/test/endpoints-tms-errors.test.ts` — unknown load → decide **200** `LOAD_UNAVAILABLE`; search/decide timeout 504; malformed 502; `loadboard_rate` without ceiling in search JSON.
- Local repro (fake TMS via tests, or live stack):

```bash
# decide — unknown load (200 LOAD_UNAVAILABLE)
curl -sS -X POST http://127.0.0.1:8080/v1/offers/decide \
  -H "Authorization: Bearer $BRIDGE_API_KEY" -H "Content-Type: application/json" \
  -d '{"action":"negotiate","load_id":"LD_DOES_NOT_EXIST_999","carrier_counter":"","otp_challenge_status":"passed","current_load_id":"","offers_history":[]}'

# search — repeat
curl -sS -X POST http://127.0.0.1:8080/v1/loads/search \
  -H "Authorization: Bearer $BRIDGE_API_KEY" -H "Content-Type: application/json" \
  -d '{"equipment_type":"DRY_VAN","origin_state":"AL","dest_state":"MO"}'
```

Expect **200** with `agent.decision` **LOAD_UNAVAILABLE** for the fake load; search **200** with `loads[].loadboard_rate` and no ceiling in JSON.
