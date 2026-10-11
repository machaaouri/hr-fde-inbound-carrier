# Negotiation pricing (POST /v1/offers/decide)

Authoritative summary for **D2** (`docs/decisions.md`). Replaces the old “88% opening” schedule. Aligns broker speech with **loadboard_rate** the carrier already heard from search.

## Rules (`bridge/src/negotiation/policy.ts`)

1. **Opening** = TMS posted **RATE** (loadboard_rate). If `RATE > MAX_BUY`, open at **max_rate** (`MAX_BUY`) and log a warning (`loadboard_rate exceeds max_rate; opening clamped to max_rate`).
2. **Counter ≤ last broker quote** → **ACCEPT** at the carrier’s number.
3. **Counter above last quote** → broker moves partway toward the carrier using round fractions `[0.4, 0.65, 0.85]`, floored to **$25**, capped below **max_rate** by a round-specific margin (`50 / 40 / 30` USD) so responses do not sit on max_rate every time.
4. Every broker counter is **≥ previous quote**, **≤ max_rate**, and **≤ carrier counter**.
5. If the carrier is still above the broker after **round 3** → **FINAL_REJECT**.
6. **max_rate** is used only inside the bridge; HTTP JSON never includes `MAX_BUY` / ceiling fields.

Twin **`standing_offer`** is the previous broker quote fed into `previousBrokerOffer` on counter rounds.
