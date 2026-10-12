import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import type { BridgeConfig } from "../config/types.ts";
import { BridgeError, toErrorEnvelope, unauthorizedError } from "../http/errors.ts";
import { createRequestContext } from "../http/request-context.ts";
import { bindRequestContext } from "../http/request-timing.ts";
import {
  endpointForUrl,
  logRouteOutcome,
  setRouteOutcome,
} from "../http/route-log.ts";
import { parseSearchLoadsInput } from "../loads/parse-search-body.ts";
import { sendOtpBody, verifyCarrierBody, verifyOtpBody } from "../http/schemas.ts";
import { bookingForWorkflow } from "../bookings/booking-workflow-service.ts";
import { parseBookingWorkflowInput } from "../bookings/parse-booking-body.ts";
import { decideOfferForWorkflow } from "../offers/decide-service.ts";
import { parseDecideWorkflowInput } from "../offers/parse-decide-body.ts";
import { verifyCarrierByMc } from "../carriers/verify-service.ts";
import { FmcsaClient } from "../fmcsa/client.ts";
import type { VerifyCarrierResult } from "../fmcsa/types.ts";
import { searchLoads } from "../loads/search-service.ts";
import { TmsClient } from "../tms/client.ts";
import { handleSendOtp, handleVerifyOtp } from "../http/otp-handlers.ts";

export type BuildAppDeps = {
  tms?: TmsClient;
  fmcsa?: FmcsaClient;
};

const LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "req.body.otp_code",
  "req.body.code",
  "req.body.code_hash",
  "req.body.salt",
  "TMS_TOKEN",
  "FMCSA_API_KEY",
  "BRIDGE_API_KEY",
  "max_rate",
  "maxBuy",
  "max_buy",
  "MAX_BUY",
  "*.max_rate",
  "*.maxBuy",
  "*.max_buy",
];

export async function buildApp(
  config: BridgeConfig,
  deps: BuildAppDeps = {},
): Promise<FastifyInstance> {
  const tms = deps.tms ?? TmsClient.fromConfig(config);
  const fmcsa = deps.fmcsa ?? FmcsaClient.fromConfig(config);
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: LOG_REDACT_PATHS,
        remove: true,
      },
    },
    requestIdHeader: false,
  });

  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
  });

  app.addHook("onRequest", async (req, reply) => {
    const ctx = createRequestContext(req);
    req.ctx = ctx;
    bindRequestContext(ctx);
    reply.header("x-request-id", ctx.requestId);
  });

  app.addHook("onResponse", async (req, reply) => {
    if (req.ctx.routeOutcome === undefined && reply.statusCode >= 400) {
      setRouteOutcome(req, {
        endpoint: endpointForUrl(req.url),
        status: "error",
        error_code: reply.statusCode === 401 ? "UNAUTHORIZED" : "INTERNAL",
      });
    }
    logRouteOutcome(req.log, req);
  });

  app.setErrorHandler((err, req, reply) => {
    const requestId = req.ctx?.requestId ?? "unknown";
    const endpoint = endpointForUrl(req.url);
    if (err instanceof ZodError) {
      const message = err.issues[0]?.message ?? "Validation failed";
      const bridgeErr = new BridgeError("VALIDATION_ERROR", message, 422);
      setRouteOutcome(req, {
        endpoint,
        status: "error",
        error_code: bridgeErr.code,
      });
      return reply
        .status(422)
        .send(toErrorEnvelope(bridgeErr, requestId));
    }
    if (err instanceof BridgeError) {
      setRouteOutcome(req, {
        endpoint,
        status: "error",
        error_code: err.code,
      });
      return reply.status(err.statusCode).send(toErrorEnvelope(err, requestId));
    }
    setRouteOutcome(req, {
      endpoint,
      status: "error",
      error_code: "INTERNAL",
    });
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send(
      toErrorEnvelope(
        new BridgeError("INTERNAL", "Internal server error", 500, true),
        requestId,
      ),
    );
  });

  function requireAuth(authHeader: string | undefined): void {
    if (!authHeader?.startsWith("Bearer ")) {
      throw unauthorizedError();
    }
    const token = authHeader.slice("Bearer ".length).trim();
    if (token !== config.bridgeApiKey) {
      throw unauthorizedError();
    }
  }

  app.get("/health", async (req) => {
    setRouteOutcome(req, { endpoint: "health", status: "ok" });
    return { status: "ok" as const };
  });

  app.post("/v1/carriers/verify", async (req) => {
    requireAuth(req.headers.authorization);
    const body = verifyCarrierBody.parse(req.body);
    const result = await verifyCarrierByMc(fmcsa, body.mc_number);
    setRouteOutcome(req, {
      endpoint: "carriers/verify",
      status: result.eligible ? "eligible" : "ineligible",
      decision: result.reason,
    });
    return toVerifyCarrierWire(result);
  });

  app.post("/v1/loads/search", async (req) => {
    requireAuth(req.headers.authorization);
    const input = parseSearchLoadsInput(req.body);
    const result = await searchLoads(tms, config.tmsToken, input);
    setRouteOutcome(req, {
      endpoint: "loads/search",
      status: "ok",
      decision: String(result.loads.length),
    });
    return result;
  });

  app.post("/v1/offers/decide", async (req) => {
    requireAuth(req.headers.authorization);
    const parsed = parseDecideWorkflowInput(req.body);
    const result = await decideOfferForWorkflow(tms, config, parsed, {
      warn: (fields, message) => req.log.warn(fields, message),
    });
    setRouteOutcome(req, {
      endpoint: "offers/decide",
      decision: result.agent.decision,
      status: parsed.action,
    });
    return result;
  });

  app.post("/v1/bookings", async (req) => {
    requireAuth(req.headers.authorization);
    const parsed = parseBookingWorkflowInput(req.body);
    const result = await bookingForWorkflow(tms, config, parsed);
    setRouteOutcome(req, {
      endpoint: "bookings/create",
      status: result.agent.status,
    });
    return result;
  });

  app.post("/v1/otp/send", async (req) => {
    requireAuth(req.headers.authorization);
    const body = sendOtpBody.parse(req.body);
    const out = handleSendOtp(body);
    setRouteOutcome(req, {
      endpoint: "otp/send",
      status: "sent",
    });
    return out;
  });

  app.post("/v1/otp/verify", async (req) => {
    requireAuth(req.headers.authorization);
    const body = verifyOtpBody.parse(req.body);
    const out = handleVerifyOtp(body);
    setRouteOutcome(req, {
      endpoint: "otp/verify",
      status: out.result,
      decision: String(out.attempts),
    });
    return out;
  });

  return app;
}

function toVerifyCarrierWire(result: VerifyCarrierResult): VerifyCarrierResult {
  const wire: VerifyCarrierResult = {
    eligible: result.eligible,
    reason: result.reason,
  };
  if (result.carrier_name) {
    wire.carrier_name = result.carrier_name;
  }
  if (result.dot_number) {
    wire.dot_number = result.dot_number;
  }
  if (result.contact_email) {
    wire.contact_email = result.contact_email;
  }
  return wire;
}
