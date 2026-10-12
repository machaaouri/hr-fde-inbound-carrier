import type {
  AgentOfferDecision,
  DecideCallsPatch,
  DecideOfferLog,
  DecideWorkflowResponse,
} from "./decide-types.ts";

/** Guard for tests — responses must never leak TMS pricing fields. */
export function assertNoSensitivePricingFields(json: string): void {
  if (/max_buy|maxbuy|ceiling|posted_rate|loadboard/i.test(json)) {
    throw new Error("response leaks internal pricing fields");
  }
}

type BuildParams = {
  decision: AgentOfferDecision;
  broker_offer: number | null;
  agreed_rate: number | null;
  rounds_remaining: number;
  offer: DecideOfferLog | null;
  calls: DecideCallsPatch;
};

export function buildDecideWorkflowResponse(p: BuildParams): DecideWorkflowResponse {
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
