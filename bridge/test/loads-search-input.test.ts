import { describe, expect, it } from "vitest";
import { BridgeError } from "../src/http/errors.ts";
import { normalizeSearchLoadsInput } from "../src/loads/normalize-search-input.ts";
import { toLoadQueryFilters } from "../src/loads/to-tms-filters.ts";
import { encodeLoadQuery } from "../src/tms/commands.ts";

const AUTH = "t-test";

function expectValidation(fn: () => void): void {
  try {
    fn();
    throw new Error("expected validation error");
  } catch (err) {
    expect(err).toBeInstanceOf(BridgeError);
    expect((err as BridgeError).code).toBe("VALIDATION_ERROR");
    expect((err as BridgeError).statusCode).toBe(422);
  }
}

describe("normalizeSearchLoadsInput", () => {
  it.each([
    ["origin_state", { equipment_type: "DRY_VAN", origin_state: "" }],
    ["dest_state", { equipment_type: "DRY_VAN", dest_state: "   " }],
    ["origin_city", { equipment_type: "DRY_VAN", origin_city: "" }],
    ["pickup_date", { equipment_type: "DRY_VAN", pickup_date: "" }],
  ] as const)("treats empty %s as not provided", (_field, body) => {
    const out = normalizeSearchLoadsInput(body);
    expect(out.equipment_type).toBe("DRY_VAN");
    if ("origin_state" in body) expect(out.origin_state).toBeUndefined();
    if ("dest_state" in body) expect(out.dest_state).toBeUndefined();
    if ("origin_city" in body) expect(out.origin_city).toBeUndefined();
    if ("pickup_date" in body) expect(out.pickup_date).toBeUndefined();
  });

  it("allows only origin_state", () => {
    const out = normalizeSearchLoadsInput({
      equipment_type: "REEFER",
      origin_state: "AL",
    });
    expect(out.origin_state).toBe("AL");
    expect(out.dest_state).toBeUndefined();
  });

  it("allows only dest_state", () => {
    const out = normalizeSearchLoadsInput({
      equipment_type: "REEFER",
      dest_state: "MO",
    });
    expect(out.dest_state).toBe("MO");
    expect(out.origin_state).toBeUndefined();
  });

  it("allows only equipment_type", () => {
    const out = normalizeSearchLoadsInput({
      equipment_type: "FLATBED",
    });
    expect(out.equipment_type).toBe("FLATBED");
    expect(out.origin_state).toBeUndefined();
    expect(out.dest_state).toBeUndefined();
    expect(out.origin_city).toBeUndefined();
  });

  it("uppercases lowercase state and equipment", () => {
    const out = normalizeSearchLoadsInput({
      equipment_type: "dry_van",
      origin_state: "ga",
      dest_state: "tx",
    });
    expect(out.equipment_type).toBe("DRY_VAN");
    expect(out.origin_state).toBe("GA");
    expect(out.dest_state).toBe("TX");
  });

  it("rejects invalid state names with VALIDATION_ERROR", () => {
    expectValidation(() =>
      normalizeSearchLoadsInput({
        equipment_type: "DRY_VAN",
        origin_state: "Georgia",
      }),
    );
  });

  it("trims city but does not uppercase", () => {
    const out = normalizeSearchLoadsInput({
      equipment_type: "DRY_VAN",
      origin_city: "  Miami  ",
    });
    expect(out.origin_city).toBe("Miami");
  });
});

describe("TMS LOAD_QUERY line from search input", () => {
  it("contains no empty field segments", () => {
    const normalized = normalizeSearchLoadsInput({
      equipment_type: "dry_van",
      origin_state: "",
      dest_state: "mo",
      origin_city: "",
    });
    const line = encodeLoadQuery(AUTH, toLoadQueryFilters(normalized));
    const body = line.replace(/\r\n$/, "");
    expect(body).not.toMatch(/\|[A-Z_]+:\|/);
    expect(body).not.toMatch(/\|[A-Z_]+:\s*\|/);
    expect(body).toBe(
      "CMD:LOAD_QUERY|AUTH:t-test|DEST_STATE:MO|EQTYPE:DRY_VAN",
    );
  });

  it("equipment-only query is valid for handbook", () => {
    const line = encodeLoadQuery(
      AUTH,
      toLoadQueryFilters(
        normalizeSearchLoadsInput({ equipment_type: "REEFER" }),
      ),
    );
    expect(line.replace(/\r\n$/, "")).toBe(
      "CMD:LOAD_QUERY|AUTH:t-test|EQTYPE:REEFER",
    );
  });
});
