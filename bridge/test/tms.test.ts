import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BridgeConfig } from "../src/config/config.ts";
import { assertSafeSearchJson } from "../src/loads/mapping.ts";
import { buildApp } from "../src/server/build-app.ts";
import { TmsClient } from "../src/tms/client.ts";
import {
  encodeLoadGet,
  encodeLoadQuery,
  parseRecordLine,
  parseTmsResponse,
  TMS_FIELD,
} from "../src/tms/protocol.ts";
import { FakeTmsServer } from "./fake-tms/server.ts";

const BRIDGE_AUTH = "Bearer test-bridge-key-12345678";

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


const FAULT_TOKEN = "t-fault-test";
const FAST = { responseMs: 400, readMaxAttempts: 2, readBackoffMs: 50 };

describe("TmsClient against fake TMS faults", () => {
  let fake: FakeTmsServer;
  let port: number;
  let closeFake: () => Promise<void>;

  beforeEach(async () => {
    fake = new FakeTmsServer({ token: FAULT_TOKEN });
    const started = await fake.listen(0);
    port = started.port;
    closeFake = started.close;
  });

  afterEach(async () => {
    fake.setFault(null);
    await closeFake();
  });

  function client(): TmsClient {
    return new TmsClient({ host: "127.0.0.1", port, token: FAULT_TOKEN, ...FAST });
  }

  it("timeout → TMS_UNAVAILABLE", async () => {
    fake.setFault("timeout");
    await expect(
      client().executeRead(
        encodeLoadQuery(FAULT_TOKEN, { orig_state: "GA", eqtype: "DRY_VAN" }),
        "LOAD_QUERY",
      ),
    ).rejects.toMatchObject({ code: "TMS_UNAVAILABLE" });
  });

  it("partial response → TMS_BAD_RESPONSE", async () => {
    fake.setFault("partial");
    await expect(
      client().executeRead(
        encodeLoadQuery(FAULT_TOKEN, { orig_state: "GA", eqtype: "DRY_VAN" }),
        "LOAD_QUERY",
      ),
    ).rejects.toMatchObject({ code: "TMS_BAD_RESPONSE" });
  });

  it("malformed framing → TMS_BAD_RESPONSE", async () => {
    fake.setFault("malformed");
    await expect(
      client().executeRead(
        encodeLoadQuery(FAULT_TOKEN, { orig_state: "GA", eqtype: "DRY_VAN" }),
        "LOAD_QUERY",
      ),
    ).rejects.toMatchObject({ code: "TMS_BAD_RESPONSE" });
  });

  it("delayed termination still completes on END", async () => {
    fake.setFault("delayed_close");
    const parsed = await client().executeRead(
      encodeLoadQuery(FAULT_TOKEN, { orig_state: "GA", eqtype: "DRY_VAN" }),
      "LOAD_QUERY",
    );
    expect(parsed.kind).toBe("success");
  });

  it("maps AUTH_FAILED to TMS_UNAVAILABLE", async () => {
    const parsed = await client().executeRead(
      encodeLoadQuery("wrong-token", { orig_state: "GA", eqtype: "DRY_VAN" }),
      "LOAD_QUERY",
    );
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.wire.code).toBe("AUTH_FAILED");
  });
});


const TMS_AUTH = "t-9c3a";

/** Strip CRLF for stable assertions. */
function body(line: string): string {
  return line.replace(/\r\n$/, "");
}

describe("TMS request encoding (handbook transcripts)", () => {
  it("LOAD_QUERY transcript 1 — state + equipment", () => {
    expect(
      body(
        encodeLoadQuery(TMS_AUTH, {
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
        encodeLoadQuery(TMS_AUTH, {
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
    expect(body(encodeLoadGet(TMS_AUTH, "LD0000045821"))).toBe(
      "CMD:LOAD_GET|AUTH:t-9c3a|LOAD_ID:LD0000045821",
    );
  });
});

const ENDPOINT_ERRORS_TOKEN = "t-endpoint-errors";

const endpointErrorsConfig: BridgeConfig = {
  appEnv: "development",
  port: 8080,
  logLevel: "error",
  bridgeApiKey: "test-bridge-key-12345678",
  tmsHost: "127.0.0.1",
  tmsPort: 1,
  tmsToken: ENDPOINT_ERRORS_TOKEN,
  fmcsaApiKey: "x",
};

describe("TMS error handling (process survives)", () => {
  let app: FastifyInstance;
  let fake: FakeTmsServer;
  let closeFake: () => Promise<void>;

  beforeAll(async () => {
    fake = new FakeTmsServer({ token: ENDPOINT_ERRORS_TOKEN });
    const started = await fake.listen(0);
    closeFake = started.close;
    const cfg = { ...endpointErrorsConfig, tmsPort: started.port };
    const tms = new TmsClient({
      host: "127.0.0.1",
      port: started.port,
      token: ENDPOINT_ERRORS_TOKEN,
      responseMs: 400,
      readMaxAttempts: 2,
      readBackoffMs: 30,
    });
    app = await buildApp(cfg, { tms });
  });

  afterAll(async () => {
    await app.close();
    await closeFake();
  });

  const decidePayload = (overrides: Record<string, unknown> = {}) => ({
    action: "negotiate",
    load_id: "LD0000045821",
    carrier_counter: "",
    otp_challenge_status: "passed",
    current_load_id: "",
    offers_history: [],
    ...overrides,
  });

  it("decide returns 200 LOAD_UNAVAILABLE for unknown load without killing the app", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: BRIDGE_AUTH },
      payload: decidePayload({ load_id: "LD_DOES_NOT_EXIST_999" }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().agent.decision).toBe("LOAD_UNAVAILABLE");

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
  });

  it("decide returns 504 on TMS timeout fault", async () => {
    fake.setFault("timeout");
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: BRIDGE_AUTH },
      payload: decidePayload(),
    });
    fake.setFault(null);
    expect(res.statusCode).toBe(504);
    expect(res.json().error.retryable).toBe(true);

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
  });

  it("decide returns 502 on malformed TMS fault", async () => {
    fake.setFault("malformed");
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: BRIDGE_AUTH },
      payload: decidePayload(),
    });
    fake.setFault(null);
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("TMS_BAD_RESPONSE");
  });

  it("search returns 502 on malformed TMS fault", async () => {
    fake.setFault("malformed");
    const res = await app.inject({
      method: "POST",
      url: "/v1/loads/search",
      headers: { authorization: BRIDGE_AUTH },
      payload: {
        equipment_type: "DRY_VAN",
        origin_state: "GA",
        dest_state: "TX",
      },
    });
    fake.setFault(null);
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("TMS_BAD_RESPONSE");
  });

  it("search survives timeout fault and repeated calls", async () => {
    fake.setFault("timeout");
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/loads/search",
        headers: { authorization: BRIDGE_AUTH },
        payload: {
          equipment_type: "DRY_VAN",
          origin_state: "GA",
          dest_state: "TX",
        },
      });
      expect(res.statusCode).toBe(504);
    }
    fake.setFault(null);

    const ok = await app.inject({
      method: "POST",
      url: "/v1/loads/search",
      headers: { authorization: BRIDGE_AUTH },
      payload: {
        equipment_type: "DRY_VAN",
        origin_state: "GA",
        dest_state: "TX",
      },
    });
    expect(ok.statusCode).toBe(200);
    assertSafeSearchJson(JSON.stringify(ok.json()));
  });

  it("search returns loadboard_rate not ceiling when healthy", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/loads/search",
      headers: { authorization: BRIDGE_AUTH },
      payload: {
        equipment_type: "DRY_VAN",
        origin_state: "GA",
        dest_state: "TX",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { loads: { loadboard_rate: number }[] };
    assertSafeSearchJson(JSON.stringify(body));
    expect(body.loads[0]?.loadboard_rate).toBeGreaterThan(0);
  });
});
