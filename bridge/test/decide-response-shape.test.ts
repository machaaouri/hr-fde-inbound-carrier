import { describe, expect, it } from "vitest";
import { assertNoSensitivePricingFields } from "../src/offers/decide-response.ts";
import { decideOffer } from "../src/negotiation/policy.ts";

const NORMAL = { postedRate: 821, maxBuy: 950 };

describe("negotiation policy wire safety", () => {
  it("OPENING equals loadboard_rate", () => {
    const raw = decideOffer({
      round: 0,
      pricing: NORMAL,
      loadAvailable: true,
    });
    expect(raw).toMatchObject({
      decision: "OPENING",
      broker_offer: 821,
      rounds_remaining: 3,
    });
    assertNoSensitivePricingFields(JSON.stringify(raw));
  });

  it("COUNTER stays below ceiling in JSON", () => {
    const raw = decideOffer({
      round: 1,
      pricing: NORMAL,
      carrierCounter: 900,
      previousBrokerOffer: 821,
      loadAvailable: true,
    });
    expect(raw.decision).toBe("COUNTER");
    expect(raw.broker_offer).toBeGreaterThan(821);
    expect(raw.broker_offer!).toBeLessThan(950);
    assertNoSensitivePricingFields(JSON.stringify(raw));
  });
});
