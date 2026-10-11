# POST /v1/offers/decide — workflow-owned negotiation

The bridge is **stateless**. HappyRobot reads the Twin `calls` row, POSTs it (plus `action` and raw `carrier_counter`), and writes back `calls` + optional `offers` row from the response. The agent only sees `agent`.

## Request

| Field | Notes |
|-------|--------|
| `action` | `"negotiate"` or `"accept"` |
| `load_id` | Load the carrier picked (`current_load_id` on accept) |
| `carrier_counter` | Raw string from the agent (`""`, `"1800"`, `"$1,800"`, `"1800.00"`, null) |
| `otp_status` | From Twin (`"passed"` required for TMS) |
| `current_load_id` | From Twin or `""` |
| `rounds_used` | `0..3` or null → 0 |
| `standing_offer` | Twin broker quote (int/string/null) |
| `agreed_rate` | Twin passthrough (int/string/null) |
| `outcome` | Twin passthrough; default `"abandoned"` if empty |

## Response `200`

```json
{
  "agent": {
    "decision": "OPENING",
    "broker_offer": 821,
    "agreed_rate": null,
    "rounds_remaining": 3
  },
  "calls": {
    "current_load_id": "LD00923",
    "rounds_used": 0,
    "standing_offer": 821,
    "agreed_rate": null,
    "outcome": "abandoned"
  },
  "offer": {
    "load_id": "LD00923",
    "round": 0,
    "carrier_counter": null,
    "broker_offer": 821,
    "decision": "OPENING"
  }
}
```

- **`agent`**: map to the voice agent tool output only.
- **`calls`**: upsert Twin `calls` exactly (dollars as numbers; workflow casts to bigint).
- **`offer`**: insert into Twin `offers` when non-null; null for `NOT_VERIFIED`, `NO_OFFER`, and some gate paths.

### Decisions on `agent.decision`

| Decision | TMS | Notes |
|----------|-----|--------|
| `NOT_VERIFIED` | No | `otp_status !== "passed"` |
| `NO_OFFER` | No | accept without `standing_offer` |
| `LOAD_UNAVAILABLE` | Maybe | Unknown or non-open load → **200**, not 404/409 |
| `OPENING` | Yes | Empty counter, new load or `rounds_used === 0` |
| `COUNTER` | Yes / No | Counter from carrier, or re-pitch same load + empty counter |
| `INVALID_COUNTER` | Usually | Bad format without TMS; policy invalid after GET |
| `FINAL_REJECT` | No if `rounds_used >= 3` | Sets `outcome` → `failed_negotiation` |
| `ACCEPT` | Yes | accept action or counter ≤ broker quote; `outcome` → `agreed` |

Pricing rules: [`negotiation-pricing.md`](./negotiation-pricing.md). HappyRobot wiring: [`workflow/W3-negotiate-accept.md`](../workflow/W3-negotiate-accept.md).

TMS transport/parser failures remain **`502` / `504`** error envelopes. `RATE_NOT_ACCEPTABLE` on accept stays **`422`**.

## Round indexing

- Workflow stores **`rounds_used`** (counters consumed).
- Negotiate counter uses policy round **`rounds_used + 1`** (or `1` after a load change).
- **`rounds_remaining` = max(0, 3 - rounds_used)** after the decision (using updated `rounds_used` when a counter round is consumed).
- Accept does **not** increment `rounds_used`.
