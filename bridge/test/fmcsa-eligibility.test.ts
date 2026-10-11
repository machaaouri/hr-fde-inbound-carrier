import { describe, expect, it } from "vitest";
import { evaluateCarrierEligibility, notFoundResult } from "../src/fmcsa/evaluate-eligibility.ts";
import { normalizeMcDocket } from "../src/fmcsa/normalize-mc.ts";
import {
  readCarrierAuthorityRows,
  readCarrierFromDocketBody,
} from "../src/fmcsa/parse-json.ts";

describe("normalizeMcDocket", () => {
  it("strips MC prefix", () => {
    expect(normalizeMcDocket("MC784219")).toBe("784219");
    expect(normalizeMcDocket("mc-784219")).toBe("784219");
    expect(normalizeMcDocket("784219")).toBe("784219");
  });

  it("rejects garbage", () => {
    expect(normalizeMcDocket("")).toBeNull();
    expect(normalizeMcDocket("MC")).toBeNull();
  });
});

describe("evaluateCarrierEligibility", () => {
  const carrier = {
    dotNumber: 123456,
    legalName: "Test Carrier LLC",
    allowedToOperate: "Y",
    commonAuthorityStatus: "A",
    contractAuthorityStatus: "N",
    oosDate: null,
  };

  it("ACTIVE when allowed and common authority A on docket", () => {
    const out = evaluateCarrierEligibility(carrier, []);
    expect(out).toMatchObject({
      eligible: true,
      reason: "ACTIVE",
      carrier_name: "Test Carrier LLC",
      dot_number: "123456",
    });
  });

  it("ACTIVE when contract A on authority row", () => {
    const out = evaluateCarrierEligibility(
      { ...carrier, commonAuthorityStatus: "I" },
      [{ contractAuthorityStatus: "A", commonAuthorityStatus: "N" }],
    );
    expect(out.reason).toBe("ACTIVE");
  });

  it("NOT_AUTHORIZED when not allowed to operate", () => {
    const out = evaluateCarrierEligibility(
      { ...carrier, allowedToOperate: "N" },
      [],
    );
    expect(out.reason).toBe("NOT_AUTHORIZED");
    expect(out.eligible).toBe(false);
  });

  it("NOT_AUTHORIZED when common/contract not A", () => {
    const out = evaluateCarrierEligibility(
      {
        ...carrier,
        commonAuthorityStatus: "I",
        contractAuthorityStatus: "N",
      },
      [],
    );
    expect(out.reason).toBe("NOT_AUTHORIZED");
  });

  it("OUT_OF_SERVICE when oosDate set", () => {
    const out = evaluateCarrierEligibility(
      { ...carrier, oosDate: "2020-01-01" },
      [],
    );
    expect(out.reason).toBe("OUT_OF_SERVICE");
  });

  it("OUT_OF_SERVICE when outOfService Y", () => {
    const out = evaluateCarrierEligibility(
      { ...carrier, outOfService: "Y" },
      [],
    );
    expect(out.reason).toBe("OUT_OF_SERVICE");
  });

  it("NOT_FOUND helper", () => {
    expect(notFoundResult()).toEqual({ eligible: false, reason: "NOT_FOUND" });
  });
});

describe("parse FMCSA JSON shapes", () => {
  it("reads content[] docket carrier", () => {
    const carrier = readCarrierFromDocketBody({
      content: [{ carrier: { dotNumber: 1, legalName: "X", allowedToOperate: "Y" } }],
    });
    expect(carrier?.legalName).toBe("X");
  });

  it("reads nested carrier content object", () => {
    const carrier = readCarrierFromDocketBody({
      content: {
        carrier: {
          dotNumber: 1,
          legalName: "X",
          allowedToOperate: "Y",
        },
      },
    });
    expect(carrier?.legalName).toBe("X");
  });

  it("reads authority rows from content[]", () => {
    const rows = readCarrierAuthorityRows({
      content: [{ carrierAuthority: { commonAuthorityStatus: "A" } }],
    });
    expect(rows[0]?.commonAuthorityStatus).toBe("A");
  });
});
