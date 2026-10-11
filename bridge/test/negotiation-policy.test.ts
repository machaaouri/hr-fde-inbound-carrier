import { describe, expect, it } from "vitest";
import { floor25 } from "../src/negotiation/money.ts";
import {
  computeOpeningOffer,
  decideOffer,
  isLoadboardAboveMax,
  nextBrokerCounterOffer,
} from "../src/negotiation/policy.ts";

/** LD00923-style: loadboard below ceiling. */
const NORMAL = { postedRate: 821, maxBuy: 950 };

/** Handbook fake: posted above ceiling. */
const INVERTED = { postedRate: 2150, maxBuy: 1950 };

describe("opening = loadboard_rate", () => {
  it("opens at posted rate when below max", () => {
    expect(computeOpeningOffer(NORMAL)).toBe(821);
    const out = decideOffer({
      round: 0,
      pricing: NORMAL,
      loadAvailable: true,
    });
    expect(out.broker_offer).toBe(821);
  });

  it("opens at max_rate when loadboard exceeds max", () => {
    expect(isLoadboardAboveMax(INVERTED)).toBe(true);
    expect(computeOpeningOffer(INVERTED)).toBe(1950);
  });
});

describe("counter rounds", () => {
  it("accepts counter at or below current broker offer", () => {
    const out = decideOffer({
      round: 1,
      pricing: NORMAL,
      carrierCounter: 800,
      previousBrokerOffer: 821,
      loadAvailable: true,
    });
    expect(out.decision).toBe("ACCEPT");
    expect(out.agreed_rate).toBe(800);
  });

  it("accepts counter equal to current offer", () => {
    const out = decideOffer({
      round: 1,
      pricing: NORMAL,
      carrierCounter: 821,
      previousBrokerOffer: 821,
      loadAvailable: true,
    });
    expect(out.decision).toBe("ACCEPT");
    expect(out.agreed_rate).toBe(821);
  });

  it("broker counters move up toward carrier without exceeding max or counter", () => {
    const b1 = nextBrokerCounterOffer(821, 900, 950, 1);
    expect(b1).toBeGreaterThan(821);
    expect(b1).toBeLessThanOrEqual(900);
    expect(b1).toBeLessThan(950);

    const b2 = nextBrokerCounterOffer(b1, 940, 950, 2);
    expect(b2).toBeGreaterThanOrEqual(b1);
    expect(b2).toBeLessThanOrEqual(940);
    expect(b2).toBeLessThan(950);
  });

  it("never publishes max_rate on counter offers", () => {
    for (let round = 1; round <= 3; round++) {
      const offer = nextBrokerCounterOffer(821, 5000, 950, round);
      expect(offer).toBeLessThan(950);
    }
  });

  it("monotonic broker offers across three counter rounds", () => {
    let previous = 821;
    const carrier = 940;
    const offers: number[] = [];
    for (let round = 1; round <= 3; round++) {
      const b = nextBrokerCounterOffer(previous, carrier, 950, round);
      offers.push(b);
      previous = b;
    }
    expect(offers[0]).toBeLessThan(offers[1]);
    expect(offers[1]).toBeLessThanOrEqual(offers[2]);
    for (const o of offers) {
      expect(o).toBeLessThan(950);
    }
  });

  it("FINAL_REJECT on round 3 when still apart", () => {
    const out = decideOffer({
      round: 3,
      pricing: NORMAL,
      carrierCounter: 940,
      previousBrokerOffer: 875,
      loadAvailable: true,
    });
    expect(out.decision).toBe("FINAL_REJECT");
    expect(out.rounds_remaining).toBe(0);
  });

  it("INVALID_COUNTER for non-positive values", () => {
    const out = decideOffer({
      round: 1,
      pricing: NORMAL,
      carrierCounter: 0,
      previousBrokerOffer: 821,
      loadAvailable: true,
    });
    expect(out.decision).toBe("INVALID_COUNTER");
  });
});

describe("responses never embed ceiling", () => {
  it("JSON from decideOffer omits max_buy", () => {
    const out = decideOffer({
      round: 1,
      pricing: INVERTED,
      carrierCounter: 2200,
      previousBrokerOffer: 1950,
      loadAvailable: true,
    });
    expect(JSON.stringify(out)).not.toMatch(/max_buy|maxBuy|1950.*1950/i);
    expect(out.broker_offer ?? out.agreed_rate ?? 0).toBeLessThanOrEqual(2200);
    if (out.broker_offer !== undefined) {
      expect(out.broker_offer).toBeLessThanOrEqual(INVERTED.maxBuy);
    }
  });
});

describe("floor25", () => {
  it("rounds down to $25", () => {
    expect(floor25(852)).toBe(850);
  });
});
