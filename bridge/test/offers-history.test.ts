import { describe, expect, it } from "vitest";
import {
  agreedRateFromAcceptHistory,
  deriveNegotiationFromHistory,
} from "../src/twin/workflow-fields.ts";
import type { OfferHistoryRow } from "../src/twin/workflow-fields.ts";

const LOAD = "LD0000045821";

describe("offers_history derivation", () => {
  it("repeat round rows do not inflate max_round", () => {
    const rows: OfferHistoryRow[] = [
      {
        load_id: LOAD,
        round: 1,
        carrier_counter: 2200,
        broker_offer: 1775,
        decision: "COUNTER",
      },
      {
        load_id: LOAD,
        round: 1,
        carrier_counter: 2200,
        broker_offer: 1775,
        decision: "COUNTER",
      },
    ];
    expect(deriveNegotiationFromHistory(LOAD, rows).max_round).toBe(1);
  });

  it("latest broker_offer follows array order for the load", () => {
    const rows: OfferHistoryRow[] = [
      {
        load_id: LOAD,
        round: 0,
        carrier_counter: null,
        broker_offer: 1950,
        decision: "OPENING",
      },
      {
        load_id: LOAD,
        round: 1,
        carrier_counter: 2200,
        broker_offer: 1775,
        decision: "COUNTER",
      },
    ];
    expect(deriveNegotiationFromHistory(LOAD, rows).latest_broker_offer).toBe(1775);
  });

  it("agreedRateFromAcceptHistory prefers broker_offer then carrier_counter", () => {
    expect(
      agreedRateFromAcceptHistory(LOAD, [
        {
          load_id: LOAD,
          round: 1,
          carrier_counter: 850,
          broker_offer: null,
          decision: "ACCEPT",
        },
      ]),
    ).toBe(850);
    expect(
      agreedRateFromAcceptHistory(LOAD, [
        {
          load_id: LOAD,
          round: 1,
          carrier_counter: 850,
          broker_offer: 848,
          decision: "ACCEPT",
        },
      ]),
    ).toBe(848);
  });

  it("ignores rows for other loads", () => {
    const rows: OfferHistoryRow[] = [
      {
        load_id: "OTHER",
        round: 3,
        carrier_counter: null,
        broker_offer: 9999,
        decision: "OPENING",
      },
    ];
    expect(deriveNegotiationFromHistory(LOAD, rows)).toEqual({
      max_round: 0,
      latest_broker_offer: null,
    });
  });
});
