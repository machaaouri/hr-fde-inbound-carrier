# HappyRobot workflow (Version 3)

Node specs and exported JSON for the inbound carrier sales voice workflow.

| Spec | Scope |
| --- | --- |
| [`W1-web-call-verify-search.md`](./W1-web-call-verify-search.md) | Web call, `verify_carrier`, `search_loads` |
| [`W2-otp-send-verify.md`](./W2-otp-send-verify.md) | `send_otp`, `verify_otp`, search gate |
| [`W3-negotiate-accept.md`](./W3-negotiate-accept.md) | `negotiate` (opening / counter / **accept**), `book_load` |

**Six agent tools:** `verify_carrier`, `search_loads`, `send_otp`, `verify_otp`, `negotiate`, `book_load`.

Export snapshots: [`exports/`](./exports/) — **Version 3** is current for development ([`exports/README.md`](./exports/README.md)).
