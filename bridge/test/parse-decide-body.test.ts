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
  it("normalizes twin defaults", () => {
    const body = parseDecideWorkflowInput({
      action: "negotiate",
      load_id: "LD1",
      carrier_counter: "",
      otp_status: "passed",
      current_load_id: "",
      rounds_used: null,
      standing_offer: "",
      outcome: "",
    });
    expect(body.rounds_used).toBe(0);
    expect(body.outcome).toBe("abandoned");
    expect(body.standing_offer).toBeNull();
  });

  it("decideLogRound for counter on same load", () => {
    const req = parseDecideWorkflowInput({
      action: "negotiate",
      load_id: "LD1",
      current_load_id: "LD1",
      rounds_used: 1,
      carrier_counter: "1800",
      otp_status: "passed",
    });
    expect(decideLogRound(req, parseCarrierCounterRaw("1800"))).toBe(2);
  });
});
