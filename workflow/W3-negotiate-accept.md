# W3 — Negotiate, accept, book (Version 3)

**Prerequisites:** W2 complete (`otp_challenges.status` = `passed`, `search_loads` done). `@BRIDGE_BASE_URL`, `@BRIDGE_API_KEY`. Live **`POST /v1/offers/decide`** and **`POST /v1/bookings`**.

Negotiation rules live in the bridge; the workflow reads Twin, sends **`offers_history`** + **`otp_challenge_status`**, and maps **`response.agent`** / patch fields from **`response.calls`** only.

**Tools in this workflow (6):** `verify_carrier`, `search_loads`, `send_otp`, `verify_otp`, `negotiate`, `book_load`. Accepting the last quote uses **`negotiate`** with fixed `action: "accept"` (no separate accept tool).

---

## 1. Agent prompt (booking)

After the caller accepts a broker quote:

```
When the caller accepts your last broker_offer ("yes", "deal", "I'll take it"), call negotiate once with action accept (empty carrier_counter). Do not use a counter to accept.
After negotiate returns ACCEPT, call book_load once.
If book_load status is BOOKED or BOOKED_RECONCILED, confirm the booking reference. Otherwise do not claim the load is booked.
```

---

## 2. Tool: `negotiate`

**Description:** Opening offer, counter response, or accept (`action` fixed per branch).

**Agent parameter:** `carrier_counter` (string, optional) — empty on opening or on verbal accept; raw counter when the caller pushes back.

**Hidden / fixed:** Read Twin SQL builds `offers_history` and passes `otp_challenge_status` from `otp_challenges.status`.

### Steps

| Step | Node | Detail |
| --- | --- | --- |
| 1 | **Read Twin** | `calls`, `offers` rows for `@current.run_id`, `otp_challenges.status` |
| 2 | **Webhook** | `POST` `@BRIDGE_BASE_URL` + `/v1/offers/decide`, Bearer `@BRIDGE_API_KEY`, optional `X-HR-Run-Id` = `@current.run_id` |
| 3 | **Write Twin** | Merge **`response.calls`** into `calls` (only keys returned) |
| 4 | **Write Twin** | Insert `offers` from **`response.offer`** when non-null; **Continue on failure** = on |

### Webhook JSON body

| Field | Source |
| --- | --- |
| `action` | `"negotiate"` or `"accept"` (fixed per tool branch / subflow) |
| `load_id` | Load the carrier picked |
| `carrier_counter` | Agent counter or `""` |
| `current_load_id` | Twin `calls.current_load_id` or `""` |
| `otp_challenge_status` | Twin `otp_challenges.status` |
| `offers_history` | Twin `offers` rows for the run (JSON array) |

Contract: [`docs/offers-decide-workflow.md`](../docs/offers-decide-workflow.md).

### Tool Call Result (agent-visible)

Map **`response.agent`**: `decision`, `broker_offer`, `agreed_rate`, `rounds_remaining` as appropriate for the branch. Never expose `response.calls`, `response.offer`, or ceiling fields.

---

## 3. Accept path (`action: "accept"`)

Same **`negotiate`** tool (or a dedicated branch with no agent params):

| Field | Value |
| --- | --- |
| `action` | `"accept"` |
| `load_id` | Twin `calls.current_load_id` |
| `carrier_counter` | `""` |
| `offers_history` | Full Twin `offers` for the run |

If history already contains **ACCEPT** for the load, the bridge is idempotent (same `agreed_rate`, no new `offer` row).

---

## 4. HTTP errors vs business decisions

| Situation | Workflow behavior |
| --- | --- |
| **200** + `agent.decision` | Normal path; Twin writes from `calls` / `offer` |
| `LOAD_UNAVAILABLE`, `NOT_VERIFIED`, `NO_OFFER` | Still **200** — agent reads `decision` |
| **502 / 504** | Failed webhook — do not update Twin |
| **422** `RATE_NOT_ACCEPTABLE` | Failed bridge call |

---

## 5. Tool: `book_load`

**Webhook:** `POST` `@BRIDGE_BASE_URL` + `/v1/bookings`

| Field | Source |
| --- | --- |
| `load_id` | Twin `calls.current_load_id` |
| `mc_number` | Twin `calls.mc_number` |
| `agreed_rate` | Twin `calls.agreed_rate` |
| `run_id` | `@current.run_id` |
| `otp_challenge_status` | Twin `otp_challenges.status` |

Write Twin from **`response.calls`**; agent sees **`response.agent`** only. Detail: [`docs/bookings-workflow.md`](../docs/bookings-workflow.md).

---

## 6. Verified E2E scenarios

1. Search → pick load → **negotiate** (empty counter) → opening matches search loadboard rate (e.g. **LD00983** at **$821**).
2. Counter loop until **ACCEPT** at agreed rate (e.g. **$850** close-gap).
3. Three counters with no deal → **FINAL_REJECT**, `outcome` = `failed_negotiation`.
4. **`action: "accept"`** after verbal accept → **ACCEPT**, `agreed_rate` on `calls`.
5. **`book_load`** after accept → **BOOKED**, `outcome` **booked**, `booking_ref` set.

---

## 7. Export

Canonical snapshot: [`exports/inbound-carrier-sales-version-3.json`](./exports/inbound-carrier-sales-version-3.json).
