# FMCSA QCMobile — response notes

Official API: [QCMobile API](https://mobile.fmcsa.dot.gov/QCDevsite/docs/qcApi) · [API elements](https://mobile.fmcsa.dot.gov/QCDevsite/docs/apiElements). FMCSA does not publish a formal JSON schema; **`docs/fmcsa-fixtures/live-*.json`** are redacted live samples (no webKey).

**Live snapshot (redacted):** [`archive/fmcsa-probe-results.json`](./archive/fmcsa-probe-results.json) — `make probe-fmcsa` from repo root when on **US egress**.

## Endpoints used by the bridge

| Step | Path | Purpose |
| --- | --- | --- |
| 1 | `GET /carriers/docket-number/{mcDigits}?webKey=…` | Resolve MC → carrier profile + DOT |
| 2 | `GET /carriers/{dotNumber}/authority?webKey=…` | For-hire authority rows per docket |

Base URL: `https://mobile.fmcsa.dot.gov/qc/services`

## Response shapes (live)

**Docket (200):** `{ "content": [ { "carrier": { … }, "_links": { … } } ], "retrievalDate": "…" }`

**Authority (200):** `{ "content": [ { "carrierAuthority": { … } } ] }` — **`content: []`** when no active for-hire authority rows (e.g. DOT 2296639 / MC 784219).

**Invalid webKey (404 JSON):** `{ "content": "Webkey not found", … }` → bridge **`FMCSA_MISCONFIGURED`** (503, `retryable: false`).

**Geo / edge block (403 HTML):** not JSON → **`FMCSA_UNAVAILABLE`** (503, `retryable: true`).

Status codes on authority fields: **`A`** active, **`I`** inactive, **`N`** none.

## Eligibility rule (bridge)

`ACTIVE` requires all of:

1. `allowedToOperate` = **`Y`**
2. `oosDate` is **null** (and `outOfService` ≠ `Y` if present)
3. **`commonAuthorityStatus`** or **`contractAuthorityStatus`** = **`A`** on the docket `carrier` **or** on any `content[].carrierAuthority` row from `/authority`

Example: MC **784219** (BOZHA, DOT 2296639) → `allowedToOperate` Y but common **`I`**, authority **`[]`** → **`NOT_AUTHORIZED`**.

Example active authority payload: **`live-authority-active-dot54283.json`** (MC **136818**). Full MC catalog: [`qa/test-carriers.md`](../qa/test-carriers.md).

## Fields mapped to verify response

| FMCSA element | Bridge use |
| --- | --- |
| `allowedToOperate` | Must be `Y` |
| `commonAuthorityStatus`, `contractAuthorityStatus` | `A` on docket or authority row |
| `oosDate`, `outOfService` | Out of service → `OUT_OF_SERVICE` |
| `legalName` | `carrier_name` |
| `dotNumber` | `dot_number`; drives authority call |
| `emailAddress`, `email`, `emailAddr` | Optional `contact_email` (workflow hidden) |

## Bridge output contract

See `bridge/openapi.yaml` (`VerifyCarrierResponse`). Reasons: `ACTIVE`, `NOT_AUTHORIZED`, `OUT_OF_SERVICE`, `NOT_FOUND`. Transport/geo → **`FMCSA_UNAVAILABLE`**; bad webKey → **`FMCSA_MISCONFIGURED`**.

Implementation: `bridge/src/fmcsa/parse-json.ts`, `evaluate-eligibility.ts`, `client.ts`.

## Troubleshooting

### Read the HTTP body

| Response | Meaning |
| --- | --- |
| **200** + JSON with `content[].carrier` | OK |
| **404** + JSON `Webkey not found` | Fix **`FMCSA_API_KEY`** |
| **403** + **HTML** | **Geo/VPN egress** — run bridge from US network |

If real and fake webKey both return **403 HTML**, treat as network location, not key format.

Tests lock the live fixtures in `bridge/test/fmcsa-fixtures.test.ts`.
