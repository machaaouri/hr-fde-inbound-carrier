import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { RequestContext } from "./types.ts";

const HR_RUN_HEADER = "x-hr-run-id";

export function createRequestContext(req: FastifyRequest): RequestContext {
  const hrRunId = req.headers[HR_RUN_HEADER];
  return {
    requestId: randomUUID(),
    hrRunId: typeof hrRunId === "string" ? hrRunId : undefined,
    startedAtMs: performance.now(),
    tmsMs: 0,
  };
}
