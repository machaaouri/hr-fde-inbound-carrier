# Workflow exports

Snapshots of the HappyRobot workflow JSON used for regression and deploy handoff.

| File | Description |
| --- | --- |
| [`inbound-carrier-sales-version-2.json`](./inbound-carrier-sales-version-2.json) | **Current** inbound carrier sales workflow — 7 tools, Twin read/write, bridge webhooks. Do not change tool URLs or bodies without matching bridge/OpenAPI. |

Import or diff in the HappyRobot UI when validating platform changes. Node-level specs remain in [`../W1-web-call-verify-search.md`](../W1-web-call-verify-search.md), [`../W2-otp-send-verify.md`](../W2-otp-send-verify.md), and [`../W3-negotiate-accept.md`](../W3-negotiate-accept.md).
