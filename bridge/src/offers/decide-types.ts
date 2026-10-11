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
  otp_status: string;
  current_load_id: string;
  rounds_used: number;
  standing_offer: number | null;
  agreed_rate: number | null;
  outcome: string;
};

export type DecideOfferLog = {
  load_id: string;
  round: number;
  carrier_counter: number | null;
  broker_offer: number | null;
  decision: string;
};

export type DecideWorkflowResponse = {
  agent: {
    decision: AgentOfferDecision;
    broker_offer: number | null;
    agreed_rate: number | null;
    rounds_remaining: number;
  };
  calls: {
    current_load_id: string;
    rounds_used: number;
    standing_offer: number | null;
    agreed_rate: number | null;
    outcome: string;
  };
  offer: DecideOfferLog | null;
};
