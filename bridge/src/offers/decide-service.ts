import type { BridgeConfig } from "../config/config.ts";
import { BridgeError } from "../http/errors.ts";
import {
  agreedRateFromAcceptHistory,
  sameNegotiationLoad,
  type OfferHistoryRow,
} from "../http/request-parsing.ts";
import { isBookableLoad, tmsPaddedInt } from "../loads/mapping.ts";
import type { TmsClient } from "../tms/client.ts";
import { fetchLoadRecord, TMS_FIELD } from "../tms/protocol.ts";
import {
  computeOpeningOffer,
  decideOffer,
  isLoadboardAboveMax,
  type LoadPricing,
} from "./policy.ts";
import { parseCarrierCounterRaw } from "./parse-decide-body.ts";


/** Decisions exposed on `agent.decision` (includes workflow gates). */
export type AgentOfferDecision =
  | "OPENING"
  | "ACCEPT"
  | "COUNTER"
  | "FINAL_REJECT"
  | "INVALID_COUNTER"
  | "LOAD_UNAVAILABLE"
  | "NOT_VERIFIED"
  | "NO_OFFER";

export type DecideWorkflowRequest = {
  action: "negotiate" | "accept";
  load_id: string;
  carrier_counter: string;
  current_load_id: string;
  otp_challenge_status: string;
  offers_history: OfferHistoryRow[];
  /** From offers_history for this load (max round). */
  max_round: number;
  /** From offers_history for this load (last broker_offer). */
  latest_broker_offer: number | null;
};

export type DecideOfferLog = {
  load_id: string;
  round: number;
  carrier_counter: number | null;
  broker_offer: number | null;
  decision: string;
};

export type DecideCallsPatch = {
  current_load_id?: string;
  agreed_rate?: number;
  outcome?: string;
};

export type DecideWorkflowResponse = {
  agent: {
    decision: AgentOfferDecision;
    broker_offer: number | null;
    agreed_rate: number | null;
    rounds_remaining: number;
  };
  calls: DecideCallsPatch;
  offer: DecideOfferLog | null;
};

export function assertNoSensitivePricingFields(json: string): void {
  if (/max_buy|maxbuy|ceiling|posted_rate|loadboard/i.test(json)) {
    throw new Error("response leaks internal pricing fields");
  }
}

type BuildDecideParams = {
  decision: AgentOfferDecision;
  broker_offer: number | null;
  agreed_rate: number | null;
  rounds_remaining: number;
  offer: DecideOfferLog | null;
  calls: DecideCallsPatch;
};

export function buildDecideWorkflowResponse(p: BuildDecideParams): DecideWorkflowResponse {
  return {
    agent: {
      decision: p.decision,
      broker_offer: p.broker_offer,
      agreed_rate: p.agreed_rate,
      rounds_remaining: p.rounds_remaining,
    },
    calls: p.calls,
    offer: p.offer,
  };
}

export function roundsRemainingFromUsed(roundsUsed: number): number {
  return Math.max(0, 3 - roundsUsed);
}


export type LoadPricingSnapshot = LoadPricing & {
  loadAvailable: boolean;
};

/** Parse RATE/MAX_BUY when the record is already loaded. Non-bookable → no pricing fields read. */
export function parseLoadPricingFromRecord(record: Map<string, string>): LoadPricingSnapshot {
  if (!isBookableLoad(record)) {
    return { postedRate: 0, maxBuy: 0, loadAvailable: false };
  }

  let postedRate: number;
  let maxBuy: number;
  try {
    postedRate = tmsPaddedInt(record.get(TMS_FIELD.RATE) ?? "", TMS_FIELD.RATE);
    const maxRaw = record.get(TMS_FIELD.MAX_BUY);
    if (maxRaw === undefined || maxRaw.trim() === "") {
      throw new BridgeError(
        "CEILING_UNAVAILABLE",
        "Ceiling not available for this load",
        503,
        true,
      );
    }
    maxBuy = tmsPaddedInt(maxRaw, TMS_FIELD.MAX_BUY);
  } catch (err) {
    if (err instanceof BridgeError) {
      throw err;
    }
    throw new BridgeError("TMS_BAD_RESPONSE", "Invalid load pricing fields", 502, true);
  }

  return {
    postedRate,
    maxBuy,
    loadAvailable: true,
  };
}

export async function fetchLoadPricing(
  client: TmsClient,
  tmsToken: string,
  loadId: string,
): Promise<LoadPricingSnapshot> {
  const record = await fetchLoadRecord(client, tmsToken, loadId);
  return parseLoadPricingFromRecord(record);
}


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

function idempotentAcceptResponse(
  req: DecideWorkflowRequest,
  agreed: number,
): DecideWorkflowResponse {
  return buildDecideWorkflowResponse({
    decision: "ACCEPT",
    broker_offer: null,
    agreed_rate: agreed,
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
  const priorAgreed = agreedRateFromAcceptHistory(req.load_id, req.offers_history);
  if (priorAgreed !== null) {
    return idempotentAcceptResponse(req, priorAgreed);
  }

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
      broker_offer: price,
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
        broker_offer: agreed,
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
