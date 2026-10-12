# FMCSA integration

`POST /v1/carriers/verify` calls the [QCMobile API](https://mobile.fmcsa.dot.gov/QCDevsite/docs/qcApi):

1. `GET /carriers/docket-number/{mcDigits}?webKey=…`
2. `GET /carriers/{dotNumber}/authority?webKey=…`

**Eligible (`ACTIVE`):** `allowedToOperate=Y`, not `outOfService=Y`, and authority status **A** / **ACTIVE** when authority data is present.

**Fail closed:** Geo/timeout/upstream errors → **503** `FMCSA_UNAVAILABLE` (`retryable: true`). Invalid webKey (404 JSON `Webkey not found`) → **503** `FMCSA_MISCONFIGURED` (`retryable: false`). No carrier row → **200** `NOT_FOUND`. `contact_email` is included only when present on the FMCSA payload (workflow keeps it off the agent).

**Eligibility:** `allowedToOperate=Y`, `oosDate` null, and `commonAuthorityStatus` or `contractAuthorityStatus` **`A`** on docket or `/authority` rows. MC **784219** is **`NOT_AUTHORIZED`** per live fixtures.

**Deploy note:** QCMobile often returns **403 HTML** (not JSON) from non-US or VPN/cloud IPs. Live verify requires **US egress**; see [`fmcsa-handbook-notes.md`](./fmcsa-handbook-notes.md#troubleshooting).

Code: `bridge/src/fmcsa/`, `bridge/src/carriers/verify-service.ts`. Manual cases: [`qa/test-carriers.md`](../qa/test-carriers.md).

**Test MC catalog:** [`qa/test-carriers.md`](../qa/test-carriers.md) (ACTIVE / NOT_AUTHORIZED / edge cases).

**Response contract in-repo:** [`fmcsa-handbook-notes.md`](./fmcsa-handbook-notes.md), fixtures `docs/fmcsa-fixtures/live-*.json`, and [`archive/fmcsa-probe-results.json`](./archive/fmcsa-probe-results.json) (`make probe-fmcsa`; optional `FMCSA_PROBE_MC`, default **784219** in Makefile — prefer **136818** on US egress).
