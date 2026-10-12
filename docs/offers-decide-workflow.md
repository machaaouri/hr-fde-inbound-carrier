# POST /v1/offers/decide — workflow-owned negotiation

The bridge is **stateless**. HappyRobot reads Twin, POSTs negotiation context, and writes back `calls` + optional `offers` from the response. The agent only sees `agent`.

## Request — legacy (Version 2 workflow)

| Field | Notes |
|-------|--------|
| `action` | `"negotiate"` or `"accept"` |
| `load_id` | Load the carrier picked |
| `carrier_counter` | Raw string from the agent (`""`, `"1800"`, `"$1,800"`, null) |
| `otp_status` | Twin `calls.otp_status` (`"passed"` required for TMS) |
| `current_load_id` | From Twin or `""` |
| `rounds_used` | `0..3` or null → 0 |
| `standing_offer` | Twin broker quote; on **accept**, the price the carrier accepts |
| `agreed_rate` | Twin echo (returned updated in `calls`) |
| `outcome` | Twin echo; default `"abandoned"` if empty |

## Request — source-of-truth (optional, Phase 1+)

When present, these **override** the legacy copies (a warning is logged if they disagree).

| Field | Notes |
|-------|--------|
| `offers_history` | Twin `offers` rows for the run: array or JSON string. Per **`load_id`**: `rounds_used` = max `round`; negotiation standing = latest non-null `broker_offer`. Rows for other loads ignored. **`round` is not unique** (repeat-quote / accept reuse the same round). |
| `otp_challenge_status` | Twin `otp_challenges.status` (e.g. `passed`) — preferred over `otp_status`. |

**Accept with history:** `standing_offer` in the body is still the price being accepted; it must equal the latest `broker_offer` for that load in `offers_history` (and ≤ ceiling), or the bridge returns **422** `RATE_NOT_ACCEPTABLE`.

### Example — legacy opening

```json
{
  "action": "negotiate",
  "load_id": "LD0000045821",
  "carrier_counter": "",
  "otp_status": "passed",
  "current_load_id": "",
  "rounds_used": 0,
  "standing_offer": null,
  "agreed_rate": null,
  "outcome": "abandoned"
}
```

### Example — source counter (equivalent state)

```json
{
  "action": "negotiate",
  "load_id": "LD0000045821",
  "carrier_counter": "2200",
  "otp_challenge_status": "passed",
  "current_load_id": "LD0000045821",
  "offers_history": [
    { "load_id": "LD0000045821", "round": 0, "carrier_counter": null, "broker_offer": 1950, "decision": "OPENING" }
  ]
}
```

## Response `200`

Unchanged shape — see [`offers-decide-response.md`](./offers-decide-response.md). `calls.rounds_used`, `calls.standing_offer`, and echo fields remain for Version 2 but are **deprecated** on the request side.

### Decisions on `agent.decision`

| Decision | TMS | Notes |
|----------|-----|--------|
| `NOT_VERIFIED` | No | Verification not `passed` |
| `NO_OFFER` | No | accept without `standing_offer` |
| `LOAD_UNAVAILABLE` | Maybe | Unknown or non-open load → **200** |
| `OPENING` | Yes | Empty counter, new load or `rounds_used === 0` |
| `COUNTER` | Yes / No | Carrier counter or re-pitch |
| `INVALID_COUNTER` | Usually | Bad format |
| `FINAL_REJECT` | No if `rounds_used >= 3` | `outcome` → `failed_negotiation` |
| `ACCEPT` | Yes | accept or counter ≤ broker quote; `outcome` → `agreed` |

Pricing: [`negotiation-pricing.md`](./negotiation-pricing.md). Wiring: [`workflow/W3-negotiate-accept.md`](../workflow/W3-negotiate-accept.md).

TMS failures → **502/504**. Accept rate mismatch → **422** `RATE_NOT_ACCEPTABLE`.

## Round indexing

- **`rounds_used`** = counters consumed (from history max `round` or legacy copy).
- Counter policy round = **`rounds_used + 1`** on same load (or `1` after load change).
- **`rounds_remaining` = max(0, 3 - rounds_used)** after the decision.
- Accept does **not** increment `rounds_used`.
