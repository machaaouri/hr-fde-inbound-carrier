export type OfferDecision =
  | "OPENING"
  | "ACCEPT"
  | "COUNTER"
  | "FINAL_REJECT"
  | "INVALID_COUNTER"
  | "LOAD_UNAVAILABLE";

export type LoadPricing = {
  postedRate: number;
  maxBuy: number;
};

export type DecideOfferInput = {
  round: number;
  pricing: LoadPricing;
  carrierCounter?: number;
  loadAvailable: boolean;
  /** Last broker quote from negotiation; required for counter rounds. */
  previousBrokerOffer?: number;
};

export type DecideOfferResult = {
  decision: OfferDecision;
  broker_offer?: number;
  agreed_rate?: number;
  rounds_remaining: number;
};
