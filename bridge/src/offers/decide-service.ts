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
import type { DecideWorkflowRequest, DecideWorkflowResponse } from "./decide-types.ts";
import { isBookableLoad } from "../loads/tms-record.ts";
import { fetchLoadRecord } from "../tms/fetch-load-record.ts";
import { parseLoadPricingFromRecord } from "./load-pricing.ts";
import { parseCarrierCounterRaw } from "./parse-carrier-counter.ts";
import { standingOfferMatchesLastBrokerQuote } from "./standing-offer.ts";

function sameLoad(req: DecideWorkflowRequest): boolean {
  return (
    req.load_id !== "" &&
    req.current_load_id !== "" &&
    req.load_id === req.current_load_id
  );
}

function baseRoundsUsed(req: DecideWorkflowRequest): number {
  return sameLoad(req) ? req.rounds_used : 0;
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

function unavailableResponse(req: DecideWorkflowRequest): DecideWorkflowResponse {
  return buildDecideWorkflowResponse({
    decision: "LOAD_UNAVAILABLE",
    broker_offer: null,
    agreed_rate: null,
    rounds_remaining: roundsRemainingFromUsed(req.rounds_used),
    current_load_id: req.current_load_id,
    rounds_used: req.rounds_used,
    standing_offer: req.standing_offer,
    calls_agreed_rate: req.agreed_rate,
    outcome: req.outcome,
    offer: null,
  });
}

function gateNotVerified(req: DecideWorkflowRequest): DecideWorkflowResponse {
  return buildDecideWorkflowResponse({
    decision: "NOT_VERIFIED",
    broker_offer: null,
    agreed_rate: null,
    rounds_remaining: roundsRemainingFromUsed(req.rounds_used),
    current_load_id: req.current_load_id,
    rounds_used: req.rounds_used,
    standing_offer: req.standing_offer,
    calls_agreed_rate: req.agreed_rate,
    outcome: req.outcome,
    offer: null,
  });
}

function gateNoOffer(req: DecideWorkflowRequest): DecideWorkflowResponse {
  return buildDecideWorkflowResponse({
    decision: "NO_OFFER",
    broker_offer: null,
    agreed_rate: null,
    rounds_remaining: roundsRemainingFromUsed(req.rounds_used),
    current_load_id: req.current_load_id,
    rounds_used: req.rounds_used,
    standing_offer: req.standing_offer,
    calls_agreed_rate: req.agreed_rate,
    outcome: req.outcome,
    offer: null,
  });
}

async function handleAccept(
  client: TmsClient,
  config: BridgeConfig,
  req: DecideWorkflowRequest,
): Promise<DecideWorkflowResponse> {
  const standing = req.standing_offer;
  if (standing === null) {
    return gateNoOffer(req);
  }

  const fetched = await fetchPricingForDecide(client, config.tmsToken, req.load_id);
  if (fetched.status === "unavailable" || !fetched.loadAvailable) {
    return unavailableResponse(req);
  }

  if (standing > fetched.pricing.maxBuy) {
    throw new BridgeError(
      "RATE_NOT_ACCEPTABLE",
      "Standing offer exceeds allowable rate",
      422,
    );
  }
  if (!standingOfferMatchesLastBrokerQuote(fetched.pricing, req.rounds_used, standing)) {
    throw new BridgeError(
      "RATE_NOT_ACCEPTABLE",
      "Standing offer does not match the last broker offer",
      422,
    );
  }

  return buildDecideWorkflowResponse({
    decision: "ACCEPT",
    broker_offer: null,
    agreed_rate: standing,
    rounds_remaining: roundsRemainingFromUsed(req.rounds_used),
    current_load_id: req.load_id,
    rounds_used: req.rounds_used,
    standing_offer: standing,
    calls_agreed_rate: standing,
    outcome: "agreed",
    offer: {
      load_id: req.load_id,
      round: req.rounds_used,
      carrier_counter: null,
      broker_offer: null,
      decision: "ACCEPT",
    },
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
  if (sameLoad(req) && req.rounds_used > 0) {
    const standing = req.standing_offer;
    if (standing === null) {
      throw new BridgeError(
        "VALIDATION_ERROR",
        "standing_offer required to repeat broker quote",
        422,
      );
    }
    const roundsRemaining = roundsRemainingFromUsed(req.rounds_used);
    return buildDecideWorkflowResponse({
      decision: "COUNTER",
      broker_offer: standing,
      agreed_rate: null,
      rounds_remaining: roundsRemaining,
      current_load_id: req.current_load_id,
      rounds_used: req.rounds_used,
      standing_offer: standing,
      calls_agreed_rate: req.agreed_rate,
      outcome: req.outcome,
      offer: {
        load_id: req.load_id,
        round: req.rounds_used,
        carrier_counter: null,
        broker_offer: standing,
        decision: "COUNTER",
      },
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
        max_rate: fetched.pricing.maxBuy,
      },
      "loadboard_rate exceeds max_rate; opening clamped to max_rate",
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
    current_load_id: req.load_id,
    rounds_used: 0,
    standing_offer: opening,
    calls_agreed_rate: req.agreed_rate,
    outcome: req.outcome,
    offer: {
      load_id: req.load_id,
      round: 0,
      carrier_counter: null,
      broker_offer: opening,
      decision: "OPENING",
    },
  });
}

async function handleNegotiateCounter(
  client: TmsClient,
  config: BridgeConfig,
  req: DecideWorkflowRequest,
  counterDollars: number,
): Promise<DecideWorkflowResponse> {
  const base = baseRoundsUsed(req);
  if (base >= 3) {
    return buildDecideWorkflowResponse({
      decision: "FINAL_REJECT",
      broker_offer: null,
      agreed_rate: null,
      rounds_remaining: 0,
      current_load_id: req.current_load_id || req.load_id,
      rounds_used: 3,
      standing_offer: req.standing_offer,
      calls_agreed_rate: req.agreed_rate,
      outcome: "failed_negotiation",
      offer: {
        load_id: req.load_id,
        round: 3,
        carrier_counter: counterDollars,
        broker_offer: null,
        decision: "FINAL_REJECT",
      },
    });
  }

  const effectiveRound = base + 1;

  const fetched = await fetchPricingForDecide(client, config.tmsToken, req.load_id);
  if (fetched.status === "unavailable" || !fetched.loadAvailable) {
    return unavailableResponse(req);
  }

  const previousBrokerOffer =
    req.standing_offer ?? computeOpeningOffer(fetched.pricing);

  const result = decideOffer({
    round: effectiveRound,
    pricing: fetched.pricing,
    carrierCounter: counterDollars,
    loadAvailable: true,
    previousBrokerOffer,
  });

  const newRoundsUsed = effectiveRound;
  const brokerOffer = result.broker_offer ?? null;

  if (result.decision === "ACCEPT") {
    return buildDecideWorkflowResponse({
      decision: "ACCEPT",
      broker_offer: null,
      agreed_rate: result.agreed_rate ?? counterDollars,
      rounds_remaining: roundsRemainingFromUsed(newRoundsUsed),
      current_load_id: req.load_id,
      rounds_used: newRoundsUsed,
      standing_offer: req.standing_offer,
      calls_agreed_rate: result.agreed_rate ?? counterDollars,
      outcome: "agreed",
      offer: {
        load_id: req.load_id,
        round: effectiveRound,
        carrier_counter: counterDollars,
        broker_offer: null,
        decision: "ACCEPT",
      },
    });
  }

  if (result.decision === "FINAL_REJECT") {
    return buildDecideWorkflowResponse({
      decision: "FINAL_REJECT",
      broker_offer: null,
      agreed_rate: null,
      rounds_remaining: 0,
      current_load_id: req.load_id,
      rounds_used: 3,
      standing_offer: req.standing_offer,
      calls_agreed_rate: req.agreed_rate,
      outcome: "failed_negotiation",
      offer: {
        load_id: req.load_id,
        round: effectiveRound,
        carrier_counter: counterDollars,
        broker_offer: null,
        decision: "FINAL_REJECT",
      },
    });
  }

  const standingAfter =
    result.decision === "COUNTER" ? brokerOffer : req.standing_offer;

  return buildDecideWorkflowResponse({
    decision: result.decision,
    broker_offer: result.decision === "INVALID_COUNTER" ? null : brokerOffer,
    agreed_rate: null,
    rounds_remaining: roundsRemainingFromUsed(newRoundsUsed),
    current_load_id: req.load_id,
    rounds_used: newRoundsUsed,
    standing_offer:
      result.decision === "COUNTER" ? standingAfter : req.standing_offer,
    calls_agreed_rate: req.agreed_rate,
    outcome: req.outcome,
    offer: {
      load_id: req.load_id,
      round: effectiveRound,
      carrier_counter: counterDollars,
      broker_offer: result.decision === "INVALID_COUNTER" ? null : brokerOffer,
      decision: result.decision,
    },
  });
}

async function handleNegotiateCounterInvalidFormat(
  req: DecideWorkflowRequest,
): Promise<DecideWorkflowResponse> {
  const base = baseRoundsUsed(req);
  if (base >= 3) {
    return buildDecideWorkflowResponse({
      decision: "FINAL_REJECT",
      broker_offer: null,
      agreed_rate: null,
      rounds_remaining: 0,
      current_load_id: req.current_load_id || req.load_id,
      rounds_used: 3,
      standing_offer: req.standing_offer,
      calls_agreed_rate: req.agreed_rate,
      outcome: "failed_negotiation",
      offer: null,
    });
  }

  const effectiveRound = base + 1;
  return buildDecideWorkflowResponse({
    decision: "INVALID_COUNTER",
    broker_offer: null,
    agreed_rate: null,
    rounds_remaining: roundsRemainingFromUsed(effectiveRound),
    current_load_id: req.load_id || req.current_load_id,
    rounds_used: effectiveRound,
    standing_offer: req.standing_offer,
    calls_agreed_rate: req.agreed_rate,
    outcome: req.outcome,
    offer: {
      load_id: req.load_id,
      round: effectiveRound,
      carrier_counter: null,
      broker_offer: null,
      decision: "INVALID_COUNTER",
    },
  });
}

export async function decideOfferForWorkflow(
  client: TmsClient,
  config: BridgeConfig,
  req: DecideWorkflowRequest,
  log?: DecideWorkflowLog,
): Promise<DecideWorkflowResponse> {
  if (req.otp_status !== "passed") {
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
