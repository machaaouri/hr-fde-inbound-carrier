# Twin setup (platform track — step 1)

Run these scripts **in order** in the HappyRobot Twin SQL console for your org/environment:

1. `schema.sql` — tables and indexes
2. `views.sql` — `v_kpi_summary` and `v_followups`
3. `seed.sql` — `carrier_contacts` for **ACTIVE** test MCs (see [`qa/test-carriers.md`](../../qa/test-carriers.md)); OTP sent to seeded email.

## Writers (who updates what)

| Table | Written by |
| --- | --- |
| `carrier_contacts` | This seed; workflow when FMCSA returns a new email |
| `calls` | Workflow tools during the call; post-call nodes for summary/notes |
| `otp_challenges` | Workflow `send_otp` / `verify_otp` branches only |
| `offers` | Workflow on each negotiation tool call |
| `call_events` | Workflow for audit events |

## Sanity check

After schema creation, run:

```sql
SELECT * FROM v_kpi_summary;
SELECT * FROM v_followups LIMIT 5;
```

Both should succeed with zero or null KPI rows until the first test call (step 2).

## Latency (Q4)

Twin read/write latency is not documented. On first workflow tool use, note round-trip time in run details and adjust hold messaging if needed.
