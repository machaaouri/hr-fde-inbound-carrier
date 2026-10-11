# W3 — `negotiate`, `accept_offer` (live `/v1/offers/decide`)

**Status:** Built and E2E-tested in HappyRobot development (e.g. deal at **$750**, **failed_negotiation** after 3 counter rounds).

**Prerequisites:** W2 complete (`otp_status` = `passed`, `search_loads` done). `make run` + `make tunnel`; `@BRIDGE_BASE_URL`, `@BRIDGE_API_KEY`. Booking (`book_load`) stays stub until step 6.

Bridge reference: [`docs/offers-decide-workflow.md`](../docs/offers-decide-workflow.md), pricing rules [`docs/negotiation-pricing.md`](../docs/negotiation-pricing.md).

---

## Design rule

**No Conditions, Paths, or negotiation logic in the workflow.** The bridge is stateless and owns all rules (opening = loadboard rate, counter cleaning, round cap, ceiling, decisions). The workflow only:

1. **Read Twin** `calls` for `@current.run_id`
2. **POST** `/v1/offers/decide` with Twin fields + `action` + raw `carrier_counter`
3. **Upsert Twin** `calls` from `response.calls`
4. **Insert Twin** `offers` from `response.offer` (**Continue on failure** enabled — `offer` is often `null`)

Repeat that **four-step pattern** for each tool invocation.

---

## 1. Prompt add-on (after W2 search)

```text
6. After the caller picks a load, call negotiate with no carrier counter to get the opening broker_offer. The opening should match the loadboard rate you already pitched from search. Quote broker_offer only — never mention a maximum or internal cap.
7. If the caller counters, call negotiate and pass their rate as carrier_counter (speech is fine; the bridge normalizes dollars). Use decision, broker_offer, agreed_rate, and rounds_remaining from the tool:
   - OPENING or COUNTER: state broker_offer; ask to accept or counter again.
   - ACCEPT: confirm agreed_rate; stop negotiating.
   - INVALID_COUNTER: explain the number was not usable; you may still have rounds_remaining.
   - FINAL_REJECT: close professionally; no handoff for failed negotiation.
   - NOT_VERIFIED: verification required — do not negotiate.
   - LOAD_UNAVAILABLE: load no longer available — offer to search again or end the call.
8. If the caller accepts your last broker_offer as stated, call accept_offer (no carrier_counter). Do not treat accept as a counter round.
9. Do not call book_load until that tool exists in the workflow.
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

## 4. HTTP errors vs business decisions

| Situation | Workflow behavior |
| --- | --- |
| **200** + `agent.decision` | Normal path; Twin writes from `calls` / `offer` |
| `LOAD_UNAVAILABLE`, `NOT_VERIFIED`, `NO_OFFER` | Still **200** — agent reads `decision`; no HTTP branch |
| **502 / 504** (TMS) | Failed webhook — do **not** update `calls` / `offers` (same as other bridge tools) |
| **422** `RATE_NOT_ACCEPTABLE` | Rare on accept; treat as failed bridge call |

Do **not** branch on 404/409 for load state on decide — those are not used for negotiate/accept.

---

## 5. Verified E2E scenarios

1. **Search → pick load → negotiate** (empty counter) → opening equals loadboard rate from search (e.g. **LD00923** at **$821**).
2. **Counter loop** until **ACCEPT** at agreed rate (live verified e.g. **$750**).
3. **Three counters** with no deal → `FINAL_REJECT`, Twin `outcome` = `failed_negotiation`.
4. **`accept_offer`** after caller accepts last **broker_offer** → `decision` **ACCEPT**, `agreed_rate` set on `calls`.

---

## 6. Export

Export stable workflow JSON to `workflow/exports/` before step 7 publish.
