import { describe, expect, it } from "vitest";
import { TMS_FIELD } from "../../src/tms/fields.ts";
import { parseRecordLine, parseTmsResponse } from "../../src/tms/parser.ts";

describe("parseRecordLine", () => {
  it("parses handbook LOAD_QUERY row", () => {
    const line =
      "LOAD_ID:LD0000045821|ORIG_CITY:Atlanta                       |ORIG_STATE:GA|ORIG_ZIP:30303|DEST_CITY:Dallas                        |DEST_STATE:TX|DEST_ZIP:75201|PICKUP_DT:20260512080000|EQTYPE:DRY_VAN   |RATE:0002150|MILES:000785|STATUS:OPEN";
    const map = parseRecordLine(line);
    expect(map.get(TMS_FIELD.LOAD_ID)).toBe("LD0000045821");
    expect(map.get(TMS_FIELD.ORIG_STATE)).toBe("GA");
    expect(map.get(TMS_FIELD.STATUS)).toBe("OPEN");
  });
});

describe("parseTmsResponse", () => {
  it("parses success with END", () => {
    const lines = [
      "LOAD_ID:LD0000045821|ORIG_STATE:GA|STATUS:OPEN",
      "END",
    ];
    const parsed = parseTmsResponse(lines);
    expect(parsed.kind).toBe("success");
    if (parsed.kind !== "success") return;
    expect(parsed.records).toHaveLength(1);
  });

  it("parses empty success", () => {
    const parsed = parseTmsResponse(["END"]);
    expect(parsed.kind).toBe("success");
    if (parsed.kind !== "success") return;
    expect(parsed.records).toHaveLength(0);
  });

  it("parses ERR line", () => {
    const parsed = parseTmsResponse([
      "ERR|CODE:MISSING_FIELD|MSG:at least one filter required",
    ]);
    expect(parsed).toEqual({
      kind: "error",
      wire: { code: "MISSING_FIELD", message: "at least one filter required" },
    });
  });

  it("rejects partial response", () => {
    expect(() =>
      parseTmsResponse(["LOAD_ID:LD1|STATUS:OPEN"]),
    ).toThrow("TMS_PARTIAL_RESPONSE");
  });

  it("rejects malformed trailing delimiter", () => {
    expect(() =>
      parseTmsResponse(["LOAD_ID:LD-BAD|ORIG_CITY:Bad|", "END"]),
    ).toThrow("TMS_MALFORMED_RESPONSE");
  });
});
