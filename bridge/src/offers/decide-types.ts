import type { OfferHistoryRow } from "../twin/workflow-fields.ts";

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
