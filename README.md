# hr-fde-inbound-carrier

Inbound carrier sales automation for HappyRobot Logistics — voice agent, FMCSA/OTP verification, legacy TMS integration, rate negotiation, Twin logging, and ops dashboard (FDE technical challenge).

## Repository layout

| Path | Purpose |
| --- | --- |
| `bridge/` | Stateless TypeScript integration API (TMS TCP, FMCSA, negotiation) |
| `workflow/` | Workflow exports and node specs |
| `ops-app/` | Ops manager HappyRobot App (step 8) |
| `docs/` | Decisions, handbook notes, Twin SQL, probe output |
| `qa/` | Test suites and results (later steps) |

Requirements: `PROBLEM_BRIEF.md`. Architecture decisions: `docs/decisions.md`. TMS wire rules: `docs/tms-integration.md`. Build plan: `.cursor/plans/inbound_carrier_design.plan.md`.

## Local setup (step 1)

1. Copy `.env.example` to `.env` and fill secrets (never commit `.env`).
2. Install bridge tooling: `make install`
3. Probe live TMS (no secrets printed): `make probe-tms` → updates `docs/tms-probe-results.json`  
   Probe FMCSA: `make probe-fmcsa` → updates `docs/fmcsa-probe-results.json` (test MCs: [`qa/test-carriers.md`](qa/test-carriers.md))  
   Run in your **system terminal** (needs outbound TCP to `TMS_HOST`). Progress logs go to stderr.  
   If you see a timeout on `LOAD_QUERY`, re-run — the TMS randomly injects slow/no responses; the probe retries twice.
4. CI locally: `make lint typecheck test docker-build`

Twin tables: run `docs/twin/schema.sql`, `views.sql`, then edit/run `seed.sql` in the HappyRobot Twin SQL console (`docs/twin/README.md`).

**Workflow specs:** `workflow/README.md` (W1–W3). Bookings envelope: [`docs/bookings-workflow.md`](docs/bookings-workflow.md). FMCSA: [`docs/fmcsa-integration.md`](docs/fmcsa-integration.md).

**Local bridge:** `make run` + `make tunnel` in another terminal.

```bash
make run      # terminal 1 — http://localhost:8080/health
make tunnel   # terminal 2 — public https://$NGROK_DOMAIN
```
