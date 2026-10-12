# Twin SQL migrations

One-off scripts for upgrading an existing Twin database. Greenfield installs use [`../schema.sql`](../schema.sql) only.

| File | Purpose |
| --- | --- |
| `001_version3_slim_calls.sql` | Drop Version 2-only `calls` columns and remove the unused audit table. |

**Required:** run [`../views.sql`](../views.sql) immediately after this migration (views are dropped first so columns can be removed).
