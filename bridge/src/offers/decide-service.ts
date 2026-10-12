import type { BridgeConfig } from "../config/types.ts";
import { BridgeError } from "../http/errors.ts";
import {
  computeOpeningOffer,
  decideOffer,
  isLoadboardAboveMax,
} from "../negotiation/policy.ts";
import type { LoadPricing } from "../negotiation/types.ts";
import type { TmsClient } from "../tms/client.ts";
import {
  buildDecideWorkflowResponse,
  roundsRemainingFromUsed,
} from "./decide-response.ts";
import type { DecideCallsPatch, DecideWorkflowRequest, DecideWorkflowResponse } from "./decide-types.ts";
import { isBookableLoad } from "../loads/tms-record.ts";
import { fetchLoadRecord } from "../tms/fetch-load-record.ts";
import { parseLoadPricingFromRecord } from "./load-pricing.ts";
import { parseCarrierCounterRaw } from "./parse-carrier-counter.ts";
import { sameNegotiationLoad } from "../twin/workflow-fields.ts";

function sameLoad(req: DecideWorkflowRequest): boolean {
  return sameNegotiationLoad(req.load_id, req.current_load_id);
}

function baseMaxRound(req: DecideWorkflowRequest): number {
  return sameLoad(req) ? req.max_round : 0;
}

async function fetchPricingForDecide(
  client: TmsClient,
  tmsToken: string,
  loadId: string,
): Promise<
  | { status: "ok"; pricing: LoadPricing; loadAvailable: boolean }
  | { status: "unavailable" }
> {
  try {
    const record = await fetchLoadRecord(client, tmsToken, loadId);
    if (!isBookableLoad(record)) {
      return { status: "unavailable" };
    }
    const snap = parseLoadPricingFromRecord(record);
    return {
      status: "ok",
      pricing: { postedRate: snap.postedRate, maxBuy: snap.maxBuy },
      loadAvailable: true,
    };
  } catch (err) {
    if (err instanceof BridgeError && err.code === "LOAD_NOT_FOUND") {
      return { status: "unavailable" };
    }
    throw err;
  }
}

function unavailableResponse(
  req: DecideWorkflowRequest,
): DecideWorkflowResponse {
  return buildDecideWorkflowResponse({
    decision: "LOAD_UNAVAILABLE",
    broker_offer: null,
    agreed_rate: null,
    rounds_remaining: roundsRemainingFromUsed(req.max_round),
    offer: null,
    calls: {},
  });
}

function gateNotVerified(req: DecideWorkflowRequest): DecideWorkflowResponse {
  return buildDecideWorkflowResponse({
    decision: "NOT_VERIFIED",
    broker_offer: null,
    agreed_rate: null,
    rounds_remaining: roundsRemainingFromUsed(req.max_round),
    offer: null,
    calls: {},
  });
}

function gateNoOffer(req: DecideWorkflowRequest): DecideWorkflowResponse {
  return buildDecideWorkflowResponse({
    decision: "NO_OFFER",
    broker_offer: null,
    agreed_rate: null,
    rounds_remaining: roundsRemainingFromUsed(req.max_round),
    offer: null,
    calls: {},
  });
}

async function handleAccept(
  client: TmsClient,
  config: BridgeConfig,
  req: DecideWorkflowRequest,
): Promise<DecideWorkflowResponse> {
  const price = req.latest_broker_offer;
  if (price === null) {
    return gateNoOffer(req);
  }

  const fetched = await fetchPricingForDecide(client, config.tmsToken, req.load_id);
  if (fetched.status === "unavailable" || !fetched.loadAvailable) {
    return unavailableResponse(req);
  }

  if (price > fetched.pricing.maxBuy) {
    throw new BridgeError(
      "RATE_NOT_ACCEPTABLE",
      "Broker offer exceeds allowable rate",
      422,
    );
  }

  const calls: DecideCallsPatch = {
    current_load_id: req.load_id,
    agreed_rate: price,
    outcome: "agreed",
  };

  return buildDecideWorkflowResponse({
    decision: "ACCEPT",
    broker_offer: null,
    agreed_rate: price,
    rounds_remaining: roundsRemainingFromUsed(req.max_round),
    offer: {
      load_id: req.load_id,
      round: req.max_round,
      carrier_counter: null,
      broker_offer: null,
      decision: "ACCEPT",
    },
    calls,
  });
}

export type DecideWorkflowLog = {
  warn: (fields: Record<string, unknown>, message: string) => void;
};

async function handleNegotiateOpening(
  client: TmsClient,
  config: BridgeConfig,
  req: DecideWorkflowRequest,
  log?: DecideWorkflowLog,
): Promise<DecideWorkflowResponse> {
  if (sameLoad(req) && req.max_round > 0) {
    const quote = req.latest_broker_offer;
    if (quote === null) {
      throw new BridgeError(
        "VALIDATION_ERROR",
        "offers_history must include a broker_offer to repeat the quote",
        422,
      );
    }
    return buildDecideWorkflowResponse({
      decision: "COUNTER",
      broker_offer: quote,
      agreed_rate: null,
      rounds_remaining: roundsRemainingFromUsed(req.max_round),
      offer: {
        load_id: req.load_id,
        round: req.max_round,
        carrier_counter: null,
        broker_offer: quote,
        decision: "COUNTER",
      },
      calls: { current_load_id: req.load_id },
    });
  }

  const fetched = await fetchPricingForDecide(client, config.tmsToken, req.load_id);
  if (fetched.status === "unavailable" || !fetched.loadAvailable) {
    return unavailableResponse(req);
  }

  if (isLoadboardAboveMax(fetched.pricing)) {
    log?.warn(
      {
        load_id: req.load_id,
        loadboard_rate: fetched.pricing.postedRate,
        opening_clamped: true,
      },
      "loadboard_rate exceeds ceiling; opening clamped",
    );
  }

  const result = decideOffer({
    round: 0,
    pricing: fetched.pricing,
    loadAvailable: true,
  });

  const opening = result.broker_offer ?? null;
  return buildDecideWorkflowResponse({
    decision: "OPENING",
    broker_offer: opening,
    agreed_rate: null,
    rounds_remaining: 3,
    offer: {
      load_id: req.load_id,
      round: 0,
      carrier_counter: null,
      broker_offer: opening,
      decision: "OPENING",
    },
    calls: { current_load_id: req.load_id },
  });
}

async function handleNegotiateCounter(
  client: TmsClient,
  config: BridgeConfig,
  req: DecideWorkflowRequest,
  counterDollars: number,
): Promise<DecideWorkflowResponse> {
  const base = baseMaxRound(req);
  if (base >= 3) {
    return buildDecideWorkflowResponse({
      decision: "FINAL_REJECT",
      broker_offer: null,
      agreed_rate: null,
      rounds_remaining: 0,
      offer: {
        load_id: req.load_id,
        round: 3,
        carrier_counter: counterDollars,
        broker_offer: null,
        decision: "FINAL_REJECT",
      },
      calls: {
        current_load_id: req.load_id,
        outcome: "failed_negotiation",
      },
    });
  }

  const effectiveRound = base + 1;

  const fetched = await fetchPricingForDecide(client, config.tmsToken, req.load_id);
  if (fetched.status === "unavailable" || !fetched.loadAvailable) {
    return unavailableResponse(req);
  }

  const previousBrokerOffer =
    req.latest_broker_offer ?? computeOpeningOffer(fetched.pricing);

  const result = decideOffer({
    round: effectiveRound,
    pricing: fetched.pricing,
    carrierCounter: counterDollars,
    loadAvailable: true,
    previousBrokerOffer,
  });

  const newMaxRound = effectiveRound;
  const brokerOffer = result.broker_offer ?? null;

  if (result.decision === "ACCEPT") {
    const agreed = result.agreed_rate ?? counterDollars;
    return buildDecideWorkflowResponse({
      decision: "ACCEPT",
      broker_offer: null,
      agreed_rate: agreed,
      rounds_remaining: roundsRemainingFromUsed(newMaxRound),
      offer: {
        load_id: req.load_id,
        round: effectiveRound,
        carrier_counter: counterDollars,
        broker_offer: null,
        decision: "ACCEPT",
      },
      calls: {
        current_load_id: req.load_id,
        agreed_rate: agreed,
        outcome: "agreed",
      },
    });
  }

  if (result.decision === "FINAL_REJECT") {
    return buildDecideWorkflowResponse({
      decision: "FINAL_REJECT",
      broker_offer: null,
      agreed_rate: null,
      rounds_remaining: 0,
      offer: {
        load_id: req.load_id,
        round: effectiveRound,
        carrier_counter: counterDollars,
        broker_offer: null,
        decision: "FINAL_REJECT",
      },
      calls: {
        current_load_id: req.load_id,
        outcome: "failed_negotiation",
      },
    });
  }

  return buildDecideWorkflowResponse({
    decision: result.decision,
    broker_offer: result.decision === "INVALID_COUNTER" ? null : brokerOffer,
    agreed_rate: null,
    rounds_remaining: roundsRemainingFromUsed(newMaxRound),
    offer: {
      load_id: req.load_id,
      round: effectiveRound,
      carrier_counter: counterDollars,
      broker_offer: result.decision === "INVALID_COUNTER" ? null : brokerOffer,
      decision: result.decision,
    },
    calls: { current_load_id: req.load_id },
  });
}

async function handleNegotiateCounterInvalidFormat(
  req: DecideWorkflowRequest,
): Promise<DecideWorkflowResponse> {
  const base = baseMaxRound(req);
  if (base >= 3) {
    return buildDecideWorkflowResponse({
      decision: "FINAL_REJECT",
      broker_offer: null,
      agreed_rate: null,
      rounds_remaining: 0,
      offer: null,
      calls: {
        current_load_id: req.load_id,
        outcome: "failed_negotiation",
      },
    });
  }

  const effectiveRound = base + 1;
  return buildDecideWorkflowResponse({
    decision: "INVALID_COUNTER",
    broker_offer: null,
    agreed_rate: null,
    rounds_remaining: roundsRemainingFromUsed(effectiveRound),
    offer: {
      load_id: req.load_id,
      round: effectiveRound,
      carrier_counter: null,
      broker_offer: null,
      decision: "INVALID_COUNTER",
    },
    calls: { current_load_id: req.load_id },
  });
}

export async function decideOfferForWorkflow(
  client: TmsClient,
  config: BridgeConfig,
  req: DecideWorkflowRequest,
  log?: DecideWorkflowLog,
): Promise<DecideWorkflowResponse> {
  if (req.otp_challenge_status !== "passed") {
    return gateNotVerified(req);
  }

  if (req.action === "accept") {
    return handleAccept(client, config, req);
  }

  const counter = parseCarrierCounterRaw(req.carrier_counter);
  if (counter.kind === "empty") {
    return handleNegotiateOpening(client, config, req, log);
  }
  if (counter.kind === "invalid") {
    return handleNegotiateCounterInvalidFormat(req);
  }

  return handleNegotiateCounter(client, config, req, counter.dollars);
}
