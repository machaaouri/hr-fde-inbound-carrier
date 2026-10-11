# W3 — Negotiate, accept, book (workflow-owned bridge)

**Prerequisites:** W2 complete (`otp_status` = `passed`, `search_loads` done). `@BRIDGE_BASE_URL`, `@BRIDGE_API_KEY` (Cloud Run or `make run` + `make tunnel`). Live **`POST /v1/offers/decide`** and **`POST /v1/bookings`**.

Negotiation rules live in the bridge; the workflow sends Twin state and maps **`response.agent`** / **`response.calls`** only.

---

## 1. Agent prompt (booking)

Add to the agent instructions after accept:

```
7. After accept_offer succeeds, call book_load to tentatively book the load.
8. If book_load agent status is BOOKED or BOOKED_RECONCILED, confirm the booking reference and mock handoff to a senior rep.
9. If status is NOT_READY, RATE_NOT_ACCEPTABLE, LOAD_UNAVAILABLE, or NOT_BOOKED, explain briefly and do not claim the load is booked.
```

---

## 2. Tool: `negotiate`

**Description:** Opening offer or response to a carrier counter.

**Agent parameter:** `carrier_counter` (string, optional) — empty or omitted on opening; raw counter text when the caller pushes back.

**Hidden / fixed in workflow:** Map from Read Twin + tool context (see webhook body). Do **not** pass `round`, `standing_offer`, or ceiling to the agent.

### Four steps

| Step | Node | Detail |
| --- | --- | --- |
| 1 | **Read Twin** | `calls` row for `@current.run_id` |
| 2 | **Webhook** | `POST` `@BRIDGE_BASE_URL` + `/v1/offers/decide`, Bearer `@BRIDGE_API_KEY`, optional `X-HR-Run-Id` = `@current.run_id` |
| 3 | **Write Twin** | Upsert `calls` from **`response.calls`** (`current_load_id`, `rounds_used`, `standing_offer`, `agreed_rate`, `outcome`) |
| 4 | **Write Twin** | Insert `offers` from **`response.offer`**; **Continue on failure** = on (skip when `offer` is null) |

### Webhook JSON body

| Field | Source |
| --- | --- |
| `action` | `"negotiate"` (fixed) |
| `load_id` | Load the carrier picked (tool / Twin; set when they choose from search) |
| `carrier_counter` | Agent `carrier_counter` or `""` for opening |
| `otp_status` | Twin `calls.otp_status` |
| `current_load_id` | Twin `calls.current_load_id` |
| `rounds_used` | Twin `calls.rounds_used` |
| `standing_offer` | Twin `calls.standing_offer` |

### Tool Call Result (agent-visible only)

Map **`response.agent`** fields:

| Field | Expose |
| --- | --- |
| `decision` | yes |
| `broker_offer` | yes |
| `agreed_rate` | yes |
| `rounds_remaining` | yes |

Never expose `response.calls`, `response.offer`, ceiling, or TMS internals.

---

## 3. Tool: `accept_offer`

**Description:** Carrier accepts the last broker quote (Twin `standing_offer`).

**Agent parameters:** none.

### Four steps

Same pattern as **`negotiate`**, with:

| Field | Value |
| --- | --- |
| `action` | `"accept"` (fixed) |
| `load_id` | Twin `calls.current_load_id` |
| `carrier_counter` | `""` (fixed) |
| `otp_status`, `current_load_id`, `rounds_used`, `standing_offer` | From Read Twin (same as negotiate) |

### Tool Call Result (agent-visible only)

Map **`response.agent`**:

| Field | Expose |
| --- | --- |
| `decision` | yes |
| `agreed_rate` | yes |

Do not expose `broker_offer`, `rounds_remaining`, or other fields for this tool (even if present on `agent`).

---

## 4. HTTP errors vs business decisions (decide)

| Situation | Workflow behavior |
| --- | --- |
| **200** + `agent.decision` | Normal path; Twin writes from `calls` / `offer` |
| `LOAD_UNAVAILABLE`, `NOT_VERIFIED`, `NO_OFFER` | Still **200** — agent reads `decision`; no HTTP branch |
| **502 / 504** (TMS) | Failed webhook — do **not** update `calls` / `offers` (same as other bridge tools) |
| **422** `RATE_NOT_ACCEPTABLE` | Rare on accept; treat as failed bridge call |

Do **not** branch on 404/409 for load state on decide — those are not used for negotiate/accept.

---

## 5. Tool: `book_load`

**Webhook:** `POST` `@BRIDGE_BASE_URL` + `/v1/bookings`

### Four steps

| Step | Node | Detail |
| --- | --- | --- |
| 1 | **Read Twin** | `calls` for `@current.run_id` |
| 2 | **Webhook** | Body below |
| 3 | **Write Twin** | Upsert `calls` from **`response.calls`** (`booking_ref`, `outcome`) |
| 4 | **Tool result** | Map **`response.agent`** only |

### Webhook JSON body

| Field | Source |
| --- | --- |
| `load_id` | Twin `calls.current_load_id` |
| `mc_number` | Twin `calls.mc_number` |
| `agreed_rate` | Twin `calls.agreed_rate` |
| `run_id` | `@current.run_id` |
| `otp_status` | Twin `calls.otp_status` |
| `outcome` | Twin `calls.outcome` |

### Tool Call Result (agent-visible only)

| Field | Expose |
| --- | --- |
| `status` | yes |
| `booking_ref` | yes |

### Business outcomes (always HTTP 200)

| `agent.status` | Agent behavior |
| --- | --- |
| `BOOKED` / `BOOKED_RECONCILED` | Confirm ref; mock handoff |
| `NOT_READY` | Gates failed — do not book |
| `RATE_NOT_ACCEPTABLE` | Rate issue — do not book |
| `LOAD_UNAVAILABLE` | Load gone — offer search or end |
| `NOT_BOOKED` | Uncertain — do not claim booked |

**Do not branch on HTTP status** for the rows above. Only **502/504** are failed webhooks (retry; do not write Twin as booked).

Detail: [`docs/bookings-workflow.md`](../docs/bookings-workflow.md).

---

## 6. Verified E2E scenarios

1. **Search → pick load → negotiate** (empty counter) → opening equals loadboard rate from search (e.g. **LD00923** at **$821**).
2. **Counter loop** until **ACCEPT** at agreed rate (live verified e.g. **$750**).
3. **Three counters** with no deal → `FINAL_REJECT`, Twin `outcome` = `failed_negotiation`.
4. **`accept_offer`** after caller accepts last **broker_offer** → `decision` **ACCEPT**, `agreed_rate` set on `calls`.
5. **`book_load`** after accept → `agent.status` **BOOKED**, Twin `outcome` **booked**, `booking_ref` set.

---

## 7. Export

Export stable workflow JSON to `workflow/exports/` before step 7 publish.
