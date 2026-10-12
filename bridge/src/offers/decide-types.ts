import type { OfferHistoryRow } from "../http/workflow-request-fields.ts";

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
