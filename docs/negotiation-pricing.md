# Negotiation pricing (POST /v1/offers/decide)

Authoritative summary for **D2** (`docs/decisions.md`). Aligns broker speech with **loadboard_rate** the carrier already heard from search.

## Rules (`bridge/src/negotiation/policy.ts`)

1. **Opening** = TMS posted **RATE** (loadboard_rate). If `RATE > MAX_BUY`, open at **max_rate** (`MAX_BUY`) and log a warning (`loadboard_rate exceeds max_rate; opening clamped to max_rate`).
2. **Counter ≤ last broker quote** → **ACCEPT** at the carrier’s number.
3. **Close gap** — if the carrier’s counter is above the last broker quote but within **max($50, 3% of that quote)** and **≤ max_rate**, **ACCEPT** at the carrier’s number (avoids silly $1 counters when the carrier is already near the posted rate).
4. **Counter farther above** — broker moves **~half the gap** toward the carrier (round fractions **0.5 → 0.65 → 0.75** on rounds 1–3), rounded down to a clean step: **$25** when the last quote is **≥ $1,000**, else **$5**. Each counter is at least one full step above the previous quote when possible.
5. Published counters stay **≤ max_rate**, **≤ carrier counter**, and usually **≥ previous quote**. When the **opening was clamped to max_rate** (loadboard above ceiling), round-1 counters use the soft cap (**max_rate − $50** on round 1) and can be **below** the opening quote (e.g. **$1,950 → $1,900**). Otherwise counters step **up** toward the carrier. Round margins **$50 / $40 / $30** below max_rate hide the ceiling.
6. If the broker meets or exceeds the carrier after rounding and the carrier is **≤ max_rate** → **ACCEPT** at the carrier’s number.
7. If still apart after **round 3** → **FINAL_REJECT**.
8. **max_rate** is used only inside the bridge; HTTP JSON never includes `MAX_BUY` / ceiling fields.

### Example (live-style)

Posted **$1,524**, carrier counters **$1,550** (gap **$26**). Threshold **max($50, 3%) = $50** → **ACCEPT $1,550**.

Posted **$1,524**, carrier **$1,700**, max_rate **$1,800** → broker counter **$1,600** (half gap, $25 step), not **$1,525**.

**LD0000045821** (handbook): loadboard **$2,150**, max_rate **$1,950** → opening **$1,950**. Carrier **$2,200** → **COUNTER** **$1,900** (above-ceiling ask; soft cap, not half-gap toward $2,200).

On counter rounds, **`offers_history`** latest **`broker_offer`** for the load is the previous broker quote (`previousBrokerOffer` in policy).
