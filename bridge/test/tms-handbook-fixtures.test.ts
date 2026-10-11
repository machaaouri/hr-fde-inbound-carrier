import { describe, expect, it } from "vitest";
import {
  encodeDebugEcho,
  encodeLoadGet,
  encodeLoadQuery,
} from "../src/tms/commands.ts";
import { debugEchoMatchesRequest } from "../src/tms/parse-echo.ts";

const AUTH = "t-9c3a";

/** Strip CRLF for stable assertions. */
function body(line: string): string {
  return line.replace(/\r\n$/, "");
}

describe("TMS request encoding (handbook transcripts)", () => {
  it("DEBUG_ECHO uses MSG", () => {
    expect(body(encodeDebugEcho(AUTH, "HELLO"))).toBe(
      "CMD:DEBUG_ECHO|AUTH:t-9c3a|MSG:HELLO",
    );
    expect(body(encodeDebugEcho(AUTH, "probe-7"))).toContain("|MSG:probe-7");
    expect(body(encodeDebugEcho(AUTH, "HELLO"))).not.toContain("PAYLOAD");
  });

  it("LOAD_QUERY transcript 1 — state + equipment", () => {
    expect(
      body(
        encodeLoadQuery(AUTH, {
          orig_state: "GA",
          dest_state: "TX",
          eqtype: "DRY_VAN",
          max_results: 5,
        }),
      ),
    ).toBe(
      "CMD:LOAD_QUERY|AUTH:t-9c3a|ORIG_STATE:GA|DEST_STATE:TX|EQTYPE:DRY_VAN|MAX_RESULTS:5",
    );
  });

  it("LOAD_QUERY transcript 2 — city + reefer", () => {
    expect(
      body(
        encodeLoadQuery(AUTH, {
          orig_city: "Miami",
          eqtype: "REEFER",
          max_results: 3,
        }),
      ),
    ).toBe(
      "CMD:LOAD_QUERY|AUTH:t-9c3a|ORIG_CITY:Miami|EQTYPE:REEFER|MAX_RESULTS:3",
    );
  });

  it("LOAD_GET transcript 1", () => {
    expect(body(encodeLoadGet(AUTH, "LD0000045821"))).toBe(
      "CMD:LOAD_GET|AUTH:t-9c3a|LOAD_ID:LD0000045821",
    );
  });
});

describe("DEBUG_ECHO response parsing", () => {
  it("matches handbook success line", () => {
    const line = "ECHO|AUTH:OK|FIELDS_PARSED:3|MSG:HELLO";
    expect(debugEchoMatchesRequest(line, "HELLO")).toBe(true);
  });

  it("rejects empty MSG when probe expected a value", () => {
    const line = "ECHO|AUTH:OK|FIELDS_PARSED:3|MSG:";
    expect(debugEchoMatchesRequest(line, "probe")).toBe(false);
  });
});
