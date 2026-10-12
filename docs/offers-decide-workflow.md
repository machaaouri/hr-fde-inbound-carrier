# POST /v1/offers/decide — workflow-owned negotiation

The bridge is **stateless**. HappyRobot reads Twin, POSTs negotiation context, and writes back `calls` + optional `offers` from the response. The agent only sees `agent`.

## Request

| Field | Notes |
|-------|--------|
| `action` | `"negotiate"` or `"accept"` |
| `load_id` | Load the carrier picked |
| `carrier_counter` | Raw string from the agent (`""`, `"1800"`, `"$1,800"`, null) |
| `current_load_id` | Twin `calls.current_load_id` or `""` |
| `otp_challenge_status` | Twin `otp_challenges.status` (`"passed"` required for TMS) |
| `offers_history` | Twin `offers` rows for the run (array or JSON string; may be `[]`) |

Per **`load_id`** in history: **`max round`** = highest `round` value (duplicate rounds do not inflate); **latest broker quote** = last non-null `broker_offer` in array order. Rows for other loads are ignored.

**Accept:** no price in the request. If history already has an **`ACCEPT`** row for this load, the call is **idempotent** (same `agreed_rate`, empty `calls`, no new `offer`). Otherwise the bridge accepts the **latest `broker_offer`** (must be ≤ ceiling). No quotable offer → **`NO_OFFER`**. Every new **`ACCEPT`** `offer` row stores the agreed price in **`broker_offer`**.

Unknown extra JSON keys are ignored.

### Example — opening

```json
{
  "action": "negotiate",
  "load_id": "LD0000045821",
  "carrier_counter": "",
  "otp_challenge_status": "passed",
  "current_load_id": "",
  "offers_history": []
}
```

### Example — counter

Handbook load **LD0000045821**: loadboard **$2,150**, ceiling **$1,950** → opening is clamped to **$1,950**. Carrier asks **$2,200** (above ceiling). Round-1 broker counter is **$1,900** (soft cap = ceiling − $50), not a move up toward $2,200. See [`negotiation-pricing.md`](./negotiation-pricing.md).

**Request:**

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

**Response:**

```json
{
  "agent": {
    "decision": "COUNTER",
    "broker_offer": 1900,
    "agreed_rate": null,
    "rounds_remaining": 2
  },
  "calls": { "current_load_id": "LD0000045821" },
  "offer": {
    "load_id": "LD0000045821",
    "round": 1,
    "carrier_counter": 2200,
    "broker_offer": 1900,
    "decision": "COUNTER"
  }
}
```

### Example — accept

```json
{
  "action": "accept",
  "load_id": "LD0000045821",
  "carrier_counter": "",
  "otp_challenge_status": "passed",
  "current_load_id": "LD0000045821",
  "offers_history": [
    { "load_id": "LD0000045821", "round": 0, "carrier_counter": null, "broker_offer": 1950, "decision": "OPENING" }
  ]
}
```

## Response `200`

```json
{
  "agent": {
    "decision": "OPENING",
    "broker_offer": 1950,
    "agreed_rate": null,
    "rounds_remaining": 3
  },
  "calls": { "current_load_id": "LD0000045821" },
  "offer": {
    "load_id": "LD0000045821",
    "round": 0,
    "carrier_counter": null,
    "broker_offer": 1950,
    "decision": "OPENING"
  }
}
```

`calls` contains **only** fields that changed this request (`current_load_id`, and `agreed_rate` / `outcome` when set). No echoes of Twin state.

### Decisions on `agent.decision`

| Decision | TMS | Notes |
|----------|-----|--------|
| `NOT_VERIFIED` | No | `otp_challenge_status` ≠ `passed` |
| `NO_OFFER` | No | accept with no broker offer in history |
| `LOAD_UNAVAILABLE` | Maybe | Unknown or non-open load → **200** |
| `OPENING` | Yes | Empty counter, new load or max round `0` |
| `COUNTER` | Yes / No | Carrier counter or re-pitch latest quote |
| `INVALID_COUNTER` | Usually | Bad format |
| `FINAL_REJECT` | No if max round ≥ 3 | `calls.outcome` → `failed_negotiation` |
| `ACCEPT` | Yes | accept or counter ≤ broker quote; `calls.outcome` → `agreed` |

Pricing: [`negotiation-pricing.md`](./negotiation-pricing.md). Wiring: [`workflow/W3-negotiate-accept.md`](../workflow/W3-negotiate-accept.md).

TMS failures → **502/504**. Accept above ceiling → **422** `RATE_NOT_ACCEPTABLE`.

## Round indexing

- **Max round** from history (or `0` when empty / load changed).
- Counter policy round = **max round + 1** on same load (or `1` after load change).
- **`rounds_remaining` = max(0, 3 − max round)** after the decision (counters consumed use max round after counter steps).
- Accept does **not** increment max round.
