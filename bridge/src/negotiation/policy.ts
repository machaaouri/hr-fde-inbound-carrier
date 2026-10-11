import { floor25 } from "./money.ts";
import type { DecideOfferInput, DecideOfferResult, LoadPricing } from "./types.ts";

/** Fraction of gap (previous → target) broker moves each counter round. */
const MEET_FRACTIONS = [0.4, 0.65, 0.85] as const;

/** Keep published counters below max_rate so probing cannot infer the ceiling. */
const CONCEAL_BELOW_MAX = [50, 40, 30] as const;

export function isLoadboardAboveMax(pricing: LoadPricing): boolean {
  return pricing.postedRate > pricing.maxBuy;
}

/** Opening pitch = loadboard_rate, clamped to max_rate when TMS posted rate exceeds ceiling. */
export function computeOpeningOffer(pricing: LoadPricing): number {
  const loadboard = pricing.postedRate;
  const maxRate = pricing.maxBuy;
  if (loadboard > maxRate) {
    return maxRate;
  }
  return loadboard;
}

function softBrokerCap(maxRate: number, round: number): number {
  const idx = Math.min(Math.max(round - 1, 0), 2);
  const margin = CONCEAL_BELOW_MAX[idx] ?? 30;
  const cap = maxRate - margin;
  if (cap <= 0) {
    return floor25(maxRate * 0.92);
  }
  return floor25(cap);
}

/**
 * Next broker counter: strictly above `previous` when carrier asks above it,
 * never above `maxRate` or the carrier's counter.
 */
export function nextBrokerCounterOffer(
  previous: number,
  carrierCounter: number,
  maxRate: number,
  round: number,
): number {
  if (carrierCounter <= previous) {
    return previous;
  }

  const softCap = softBrokerCap(maxRate, round);
  let target = Math.min(carrierCounter, softCap);
  if (target <= previous) {
    target = maxRate;
  }

  const fraction = MEET_FRACTIONS[Math.min(round - 1, 2)] ?? 0.85;
  let offer = floor25(previous + (target - previous) * fraction);

  if (offer <= previous) {
    offer = floor25(Math.min(previous + 25, maxRate));
  }
  if (offer > carrierCounter) {
    offer = carrierCounter;
  }
  if (offer > maxRate) {
    offer = floor25(maxRate);
  }
  if (offer >= maxRate) {
    offer = softBrokerCap(maxRate, round);
  }
  if (offer <= previous) {
    offer = floor25(Math.min(maxRate, previous + 25));
  }
  return offer;
}

function roundsRemaining(round: number): number {
  return Math.max(0, 3 - round);
}

function isInvalidCounter(counter: number): boolean {
  return !Number.isInteger(counter) || counter <= 0;
}

/** Pure negotiation decision (loadboard-first, ceiling never disclosed). */
export function decideOffer(input: DecideOfferInput): DecideOfferResult {
  if (!input.loadAvailable) {
    return {
      decision: "LOAD_UNAVAILABLE",
      rounds_remaining: roundsRemaining(input.round),
    };
  }

  const { round, pricing } = input;
  const maxRate = pricing.maxBuy;

  if (round === 0) {
    if (input.carrierCounter !== undefined) {
      return {
        decision: "INVALID_COUNTER",
        rounds_remaining: roundsRemaining(0),
      };
    }
    return {
      decision: "OPENING",
      broker_offer: computeOpeningOffer(pricing),
      rounds_remaining: roundsRemaining(0),
    };
  }

  if (round > 3) {
    throw new Error("round > 3");
  }

  const counter = input.carrierCounter;
  if (counter === undefined) {
    throw new Error("carrier_counter required for round >= 1");
  }

  if (isInvalidCounter(counter)) {
    return {
      decision: "INVALID_COUNTER",
      rounds_remaining: roundsRemaining(round),
    };
  }

  const previous =
    input.previousBrokerOffer ?? computeOpeningOffer(pricing);

  if (counter <= previous) {
    return {
      decision: "ACCEPT",
      agreed_rate: counter,
      rounds_remaining: roundsRemaining(round),
    };
  }

  const brokerOffer = nextBrokerCounterOffer(previous, counter, maxRate, round);

  if (counter <= maxRate && brokerOffer >= counter) {
    return {
      decision: "ACCEPT",
      agreed_rate: counter,
      rounds_remaining: roundsRemaining(round),
    };
  }

  if (round >= 3) {
    return {
      decision: "FINAL_REJECT",
      rounds_remaining: 0,
    };
  }

  return {
    decision: "COUNTER",
    broker_offer: brokerOffer,
    rounds_remaining: roundsRemaining(round),
  };
}
