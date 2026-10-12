import { describe, expect, it } from "vitest";
import { parseCarrierCounterRaw } from "../src/offers/parse-carrier-counter.ts";
import {
  decideLogRound,
  parseDecideWorkflowInput,
  parseTwinDollarField,
} from "../src/offers/parse-decide-body.ts";

describe("parseCarrierCounterRaw", () => {
  it("treats empty as opening", () => {
    expect(parseCarrierCounterRaw("")).toEqual({ kind: "empty" });
    expect(parseCarrierCounterRaw("   ")).toEqual({ kind: "empty" });
  });

  it("cleans currency strings", () => {
    expect(parseCarrierCounterRaw("$1,800")).toEqual({ kind: "ok", dollars: 1800 });
    expect(parseCarrierCounterRaw("1800.00")).toEqual({ kind: "ok", dollars: 1800 });
    expect(parseCarrierCounterRaw(" 2200 ")).toEqual({ kind: "ok", dollars: 2200 });
  });

  it("marks garbage invalid", () => {
    expect(parseCarrierCounterRaw("abc")).toEqual({ kind: "invalid" });
    expect(parseCarrierCounterRaw("0")).toEqual({ kind: "invalid" });
  });
});

describe("parseTwinDollarField", () => {
  it("parses twin nullable dollars", () => {
    expect(parseTwinDollarField(null)).toBeNull();
    expect(parseTwinDollarField("")).toBeNull();
    expect(parseTwinDollarField("1700")).toBe(1700);
    expect(parseTwinDollarField(1775)).toBe(1775);
  });
});

describe("parseDecideWorkflowInput", () => {
  it("normalizes v3 defaults", () => {
    const body = parseDecideWorkflowInput({
      action: "negotiate",
      load_id: "LD1",
      carrier_counter: "",
      otp_challenge_status: "passed",
      current_load_id: "",
    });
    expect(body.max_round).toBe(0);
    expect(body.latest_broker_offer).toBeNull();
    expect(body.offers_history).toEqual([]);
  });

  it("derives max_round from offers_history", () => {
    const body = parseDecideWorkflowInput({
      action: "negotiate",
      load_id: "LD1",
      current_load_id: "LD1",
      carrier_counter: "1800",
      otp_challenge_status: "passed",
      offers_history: [
        {
          load_id: "LD1",
          round: 1,
          carrier_counter: 2000,
          broker_offer: 1775,
          decision: "COUNTER",
        },
      ],
    });
    expect(body.max_round).toBe(1);
    expect(body.latest_broker_offer).toBe(1775);
  });

  it("decideLogRound for counter on same load", () => {
    const req = parseDecideWorkflowInput({
      action: "negotiate",
      load_id: "LD1",
      current_load_id: "LD1",
      carrier_counter: "1800",
      otp_challenge_status: "passed",
      offers_history: [
        { load_id: "LD1", round: 1, broker_offer: 1775, decision: "COUNTER" },
      ],
    });
    expect(decideLogRound(req, parseCarrierCounterRaw("1800"))).toBe(2);
  });
});
