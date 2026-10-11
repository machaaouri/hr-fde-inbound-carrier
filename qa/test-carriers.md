# FMCSA verify test carriers

Catalog of MCs checked against **live FMCSA** (US egress required — e.g. bridge on **GCP US** or US network). Re-run verify before demos; FMCSA data changes.

**Check:**

```bash
curl -sS -X POST "$BRIDGE_BASE/v1/carriers/verify" \
  -H "Authorization: Bearer $BRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mc_number":"136818"}'
```

**Bridge eligibility rule:** `allowedToOperate=Y`, `oosDate` null, and **`commonAuthorityStatus` or `contractAuthorityStatus` = `A`** on docket or `/authority`. **No BIPD/insurance check** in code today (see edge case **113843**).

**Errors (not `reason`):**

| Situation | HTTP | `error.code` |
| --- | --- | --- |
| Unknown MC | 200 | — (`NOT_FOUND`) |
| Bad webKey | 503 | `FMCSA_MISCONFIGURED` |
| Geo / upstream | 503 | `FMCSA_UNAVAILABLE` |

Never treat **`FMCSA_UNAVAILABLE`** as ineligible — system error.

Fixture reference (shapes, no webKey): `docs/fmcsa-fixtures/live-*.json`.

---

## Happy path — `ACTIVE` (freight)

Use for W1–W3 E2E; Twin seed (`docs/twin/seed.sql`) maps these MCs to **odocto1@gmail.com** for OTP.

| MC | Carrier | DOT | Notes |
| --- | --- | --- | --- |
| **136818** | Swift Transportation Co. of Arizona | 54283 | **Default E2E**; broker authority also active. Authority fixture: `live-authority-active-dot54283.json`. |
| **133655** | Schneider National Carriers | 264184 | Large common + contract **A**, insurance on file. |
| **114457** | Dart Transit Company | 75525 | Same profile class as above. |
| **150300** | Miller Transports | 177231 | Same profile class as above. |

**Suggested probe default (US):** `FMCSA_PROBE_MC=136818` in `.env`.

---

## Skip for freight-only scope

| MC | Carrier | DOT | Notes |
| --- | --- | --- | --- |
| **1515** | Greyhound Lines | 44110 | **Passenger** carrier — skip if challenge is freight-only. |

---

## Edge cases

| MC | Carrier | DOT | Expected | Notes |
| --- | --- | --- | --- | --- |
| **113843** | Refrigerated Food Express | 3833266 | **`ACTIVE`** (if contract **A** on live payload) | Common **I**, contract **A**; BIPD not on file vs $1M required — tests **contract-only** authority; bridge **does not** deny on insurance yet. Confirm live before demo. |
| **999999** | — | — | `NOT_FOUND` | Synthetic unknown docket. |

---

## Not authorized — `NOT_AUTHORIZED`

`allowedToOperate` **Y** but no active common/contract **A** (inactive authority / empty `/authority`).

| MC | Carrier | DOT | Notes |
| --- | --- | --- | --- |
| **784219** | BOZHA COMPANY INC | 2296639 | Docket fixture: `live-docket-mc784219.json`; authority **`[]`**. |
| **144221** | (live name — re-verify) | — | Same class as 784219. |
| **129284** | (live name — re-verify) | — | Same class as 784219. |

Use for “can’t work with this authority” voice path — call must **not** proceed to OTP.

---

## Twin seed

Primary OTP rows: **`docs/twin/seed.sql`** — ACTIVE freight MCs → **odocto1@gmail.com**.

Add extra `carrier_contacts` rows for any other **ACTIVE** MC you test in voice.
