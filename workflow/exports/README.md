# Workflow exports

Snapshots of the HappyRobot workflow JSON for regression and deploy handoff.

| File | Description |
| --- | --- |
| [`inbound-carrier-sales-version-3.json`](./inbound-carrier-sales-version-3.json) | **Current (development)** — 6 tools, `offers_history` + `otp_challenge_status` on decide/book, accept via `action: "accept"`. |
| [`inbound-carrier-sales-version-2.json`](./inbound-carrier-sales-version-2.json) | Retired reference — do not deploy. |

Import or diff in the HappyRobot UI when validating platform changes. Node specs: [`../W1-web-call-verify-search.md`](../W1-web-call-verify-search.md), [`../W2-otp-send-verify.md`](../W2-otp-send-verify.md), [`../W3-negotiate-accept.md`](../W3-negotiate-accept.md).
