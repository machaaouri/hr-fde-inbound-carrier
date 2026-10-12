# Bridge scripts

Manual probes against live credentials (repo-root `.env`). Not used in CI or the runtime server.

| Script | Purpose |
| --- | --- |
| [`tms-probe.ts`](./tms-probe.ts) | TCP smoke test: `DEBUG_ECHO`, broad `LOAD_QUERY`, sample `LOAD_GET` for `MAX_BUY` visibility. |
| [`fmcsa-probe.ts`](./fmcsa-probe.ts) | FMCSA API smoke test for configured MCs (eligibility fields, errors). |

Run from `bridge/`:

```bash
npx tsx scripts/tms-probe.ts
npx tsx scripts/fmcsa-probe.ts
```
