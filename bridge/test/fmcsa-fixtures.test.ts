import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateCarrierEligibility } from "../src/fmcsa/evaluate-eligibility.ts";
import {
  isWebkeyNotFoundBody,
  readCarrierAuthorityRows,
  readCarrierFromDocketBody,
} from "../src/fmcsa/parse-json.ts";

const fixturesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../docs/fmcsa-fixtures",
);

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf8")) as unknown;
}

describe("FMCSA live fixtures (docs/fmcsa-fixtures/live-*)", () => {
  it("parses MC 784219 docket + empty authority as NOT_AUTHORIZED", () => {
    const carrier = readCarrierFromDocketBody(loadFixture("live-docket-mc784219.json"));
    expect(carrier).not.toBeNull();
    const authorityRows = readCarrierAuthorityRows(
      loadFixture("live-authority-empty-dot2296639.json"),
    );
    expect(authorityRows).toHaveLength(0);
    const out = evaluateCarrierEligibility(carrier!, authorityRows);
    expect(out).toMatchObject({
      eligible: false,
      reason: "NOT_AUTHORIZED",
      carrier_name: "BOZHA COMPANY INC",
      dot_number: "2296639",
    });
  });

  it("parses active authority rows (DOT 54283) with docket common A as ACTIVE", () => {
    const authorityRows = readCarrierAuthorityRows(
      loadFixture("live-authority-active-dot54283.json"),
    );
    expect(authorityRows).toHaveLength(1);
    const carrier = {
      dotNumber: 54283,
      legalName: "Active Example Carrier",
      allowedToOperate: "Y",
      commonAuthorityStatus: "A",
      contractAuthorityStatus: "N",
      oosDate: null,
    };
    const out = evaluateCarrierEligibility(carrier, authorityRows);
    expect(out).toMatchObject({
      eligible: true,
      reason: "ACTIVE",
      dot_number: "54283",
    });
  });

  it("recognizes invalid webKey 404 JSON", () => {
    expect(isWebkeyNotFoundBody(loadFixture("live-badkey-404.json"))).toBe(true);
  });
});
