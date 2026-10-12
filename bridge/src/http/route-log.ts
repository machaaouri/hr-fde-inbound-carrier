import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import type { RouteOutcomeSnapshot } from "./types.ts";

export function setRouteOutcome(req: FastifyRequest, outcome: RouteOutcomeSnapshot): void {
  req.ctx.routeOutcome = outcome;
}

export function logRouteOutcome(log: FastifyBaseLogger, req: FastifyRequest): void {
  const outcome = req.ctx.routeOutcome;
  if (!outcome) {
    return;
  }
  const duration_ms = Math.round(performance.now() - req.ctx.startedAtMs);
  const tms_ms = req.ctx.tmsMs;
  const payload: Record<string, unknown> = {
    request_id: req.ctx.requestId,
    hr_run_id: req.ctx.hrRunId,
    endpoint: outcome.endpoint,
    duration_ms,
  };
  if (outcome.decision !== undefined) {
    payload.decision = outcome.decision;
  }
  if (outcome.status !== undefined) {
    payload.status = outcome.status;
  }
  if (outcome.error_code !== undefined) {
    payload.error_code = outcome.error_code;
  }
  if (tms_ms > 0) {
    payload.tms_ms = tms_ms;
  }
  log.info(payload, "route outcome");
}

const ROUTE_ENDPOINT: Record<string, string> = {
  "/health": "health",
  "/v1/carriers/verify": "carriers/verify",
  "/v1/loads/search": "loads/search",
  "/v1/offers/decide": "offers/decide",
  "/v1/bookings": "bookings/create",
  "/v1/otp/send": "otp/send",
  "/v1/otp/verify": "otp/verify",
};

export function endpointForUrl(url: string): string {
  const path = url.split("?")[0] ?? url;
  return ROUTE_ENDPOINT[path] ?? path;
}
