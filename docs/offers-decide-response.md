# POST /v1/offers/decide — shapes

**Workflow contract (current):** see [`offers-decide-workflow.md`](./offers-decide-workflow.md).

OpenAPI: `bridge/openapi.yaml`. Implementation: `decide-service.ts`, `parse-decide-body.ts`, `decide-response.ts`.

Summary: **200** returns `{ agent, calls, offer }`. Unknown / unavailable loads use **`agent.decision: LOAD_UNAVAILABLE`** on 200 (not 404/409). TMS transport errors stay **502/504** envelopes. Accept rate mismatch stays **422** `RATE_NOT_ACCEPTABLE`.
