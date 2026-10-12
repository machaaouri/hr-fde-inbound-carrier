import { computeOpeningOffer } from "../negotiation/policy.ts";
import type { LoadPricing } from "../negotiation/types.ts";

/** Accept path: round 0 must match loadboard opening; later rounds trust Twin standing_offer (legacy). */
export function standingOfferMatchesLastBrokerQuote(
  pricing: LoadPricing,
  roundsUsed: number,
  standingOffer: number,
): boolean {
  if (roundsUsed === 0) {
    return standingOffer === computeOpeningOffer(pricing);
  }
  if (roundsUsed < 1 || roundsUsed > 3) {
    return false;
  }
  return standingOffer > 0 && standingOffer <= pricing.maxBuy;
}

/** Source-of-truth accept: price must equal latest broker quote from offers history. */
export function standingOfferMatchesHistoryQuote(
  standingOffer: number,
  latestBrokerOffer: number | null,
  maxBuy: number,
): boolean {
  if (latestBrokerOffer === null) {
    return false;
  }
  return standingOffer === latestBrokerOffer && standingOffer <= maxBuy;
}
