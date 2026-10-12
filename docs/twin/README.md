# Twin setup (Version 3 workflow)

Run these scripts **in order** in the HappyRobot Twin SQL console for your org/environment:

1. `schema.sql` — tables and indexes (greenfield)
2. `views.sql` — `v_kpi_summary` and `v_followups`
3. `seed.sql` — `carrier_contacts` for **ACTIVE** test MCs (see [`qa/test-carriers.md`](../../qa/test-carriers.md))

**Existing Twin (Version 2 columns):** run [`migrations/001_version3_slim_calls.sql`](./migrations/001_version3_slim_calls.sql), then re-apply `views.sql`.

## Writers (Version 3)

| Table | Written by |
| --- | --- |
| `carrier_contacts` | Seed; workflow when FMCSA returns a new email |
| `calls` | Workflow tools (`fmcsa_eligible`, negotiation patches, outcome, booking) |
| `otp_challenges` | Workflow `send_otp` / `verify_otp` only |
| `offers` | Workflow on each `/v1/offers/decide` call |

Verification for decide/book webhooks comes from **`otp_challenges.status`**, not `calls`. Negotiation round state lives in **`offers`**, not `calls`.

## Sanity check

```sql
SELECT * FROM v_kpi_summary;
SELECT * FROM v_followups LIMIT 5;
```

Both should succeed with zero or null KPI rows until the first test call.
