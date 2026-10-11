import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import type { BridgeConfig } from "../config/types.ts";
import { BridgeError, toErrorEnvelope, unauthorizedError } from "../http/errors.ts";
import { createRequestContext } from "../http/request-context.ts";
import { parseSearchLoadsInput } from "../loads/parse-search-body.ts";
import {
  createBookingBody,
  sendOtpBody,
  verifyCarrierBody,
  verifyOtpBody,
} from "../http/schemas.ts";
import { decideOfferForWorkflow } from "../offers/decide-service.ts";
import {
  decideLogRound,
  parseDecideWorkflowInput,
} from "../offers/parse-decide-body.ts";
import { parseCarrierCounterRaw } from "../offers/parse-carrier-counter.ts";
import { verifyCarrierByMc } from "../carriers/verify-service.ts";
import { FmcsaClient } from "../fmcsa/client.ts";
import type { VerifyCarrierResult } from "../fmcsa/types.ts";
import { stubBooking } from "../stubs/responses.ts";
import { searchLoads } from "../loads/search-service.ts";
import { TmsClient } from "../tms/client.ts";
import { handleSendOtp, handleVerifyOtp } from "../http/otp-handlers.ts";

export type BuildAppDeps = {
  tms?: TmsClient;
  fmcsa?: FmcsaClient;
};

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
        paths: [
          "req.headers.authorization",
          "req.body.otp_code",
          "req.body.code",
          "TMS_TOKEN",
          "FMCSA_API_KEY",
          "BRIDGE_API_KEY",
        ],
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
    reply.header("x-request-id", ctx.requestId);
    if (ctx.hrRunId) {
      req.log.info({ hrRunId: ctx.hrRunId }, "happyrobot run");
    }
  });

  app.setErrorHandler((err, req, reply) => {
    const requestId = req.ctx?.requestId ?? "unknown";
    if (err instanceof BridgeError && err.retryable) {
      req.log.warn(
        { err, code: err.code, requestId, hrRunId: req.ctx?.hrRunId },
        "bridge request failed (retryable)",
      );
    }
    if (err instanceof ZodError) {
      const message = err.issues[0]?.message ?? "Validation failed";
      return reply
        .status(422)
        .send(toErrorEnvelope(new BridgeError("VALIDATION_ERROR", message, 422), requestId));
    }
    if (err instanceof BridgeError) {
      return reply.status(err.statusCode).send(toErrorEnvelope(err, requestId));
    }
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

  app.get("/healthz", async () => ({ status: "ok" as const }));

  app.post("/v1/carriers/verify", async (req) => {
    requireAuth(req.headers.authorization);
    const body = verifyCarrierBody.parse(req.body);
    const result = await verifyCarrierByMc(fmcsa, body.mc_number);
    req.log.info(
      {
        requestId: req.ctx?.requestId,
        eligible: result.eligible,
        reason: result.reason,
      },
      "carriers/verify",
    );
    return toVerifyCarrierWire(result);
  });

  app.post("/v1/loads/search", async (req) => {
    requireAuth(req.headers.authorization);
    const input = parseSearchLoadsInput(req.body);
    return searchLoads(tms, config.tmsToken, input);
  });

  app.post("/v1/offers/decide", async (req) => {
    requireAuth(req.headers.authorization);
    const body = parseDecideWorkflowInput(req.body);
    const counter = parseCarrierCounterRaw(body.carrier_counter);
    const result = await decideOfferForWorkflow(tms, config, body, {
      warn: (fields, message) => req.log.warn(fields, message),
    });
    req.log.info(
      {
        requestId: req.ctx?.requestId,
        action: body.action,
        decision: result.agent.decision,
        round: decideLogRound(body, counter),
      },
      "offers/decide",
    );
    return result;
  });

  app.post("/v1/bookings", async (req) => {
    requireAuth(req.headers.authorization);
    createBookingBody.parse(req.body);
    return stubBooking();
  });

  app.post("/v1/otp/send", async (req) => {
    requireAuth(req.headers.authorization);
    const body = sendOtpBody.parse(req.body);
    return handleSendOtp(body);
  });

  app.post("/v1/otp/verify", async (req) => {
    requireAuth(req.headers.authorization);
    const body = verifyOtpBody.parse(req.body);
    return handleVerifyOtp(body);
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
