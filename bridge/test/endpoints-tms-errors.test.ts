import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BridgeConfig } from "../src/config/types.ts";
import { assertSafeSearchJson } from "../src/loads/assert-safe-search-json.ts";
import { buildApp } from "../src/server/build-app.ts";
import { TmsClient } from "../src/tms/client.ts";
import { FakeTmsServer } from "../src/tms/fake/server.ts";

const TOKEN = "t-endpoint-errors";
const AUTH = "Bearer test-bridge-key-12345678";

const testConfig: BridgeConfig = {
  appEnv: "development",
  port: 8080,
  logLevel: "error",
  bridgeApiKey: "test-bridge-key-12345678",
  tmsHost: "127.0.0.1",
  tmsPort: 1,
  tmsToken: TOKEN,
  fmcsaApiKey: "x",
};

describe("TMS error handling (process survives)", () => {
  let app: FastifyInstance;
  let fake: FakeTmsServer;
  let closeFake: () => Promise<void>;

  beforeAll(async () => {
    fake = new FakeTmsServer({ token: TOKEN });
    const started = await fake.listen(0);
    closeFake = started.close;
    testConfig.tmsPort = started.port;
    const tms = new TmsClient({
      host: "127.0.0.1",
      port: started.port,
      token: TOKEN,
      responseMs: 400,
      readMaxAttempts: 2,
      readBackoffMs: 30,
    });
    app = await buildApp(testConfig, { tms });
  });

  afterAll(async () => {
    await app.close();
    await closeFake();
  });

  const decidePayload = (overrides: Record<string, unknown> = {}) => ({
    action: "negotiate",
    load_id: "LD0000045821",
    carrier_counter: "",
    otp_status: "passed",
    current_load_id: "",
    rounds_used: 0,
    standing_offer: null,
    agreed_rate: null,
    outcome: "abandoned",
    ...overrides,
  });

  it("decide returns 200 LOAD_UNAVAILABLE for unknown load without killing the app", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
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
      headers: { authorization: AUTH },
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
      headers: { authorization: AUTH },
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
      headers: { authorization: AUTH },
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
        headers: { authorization: AUTH },
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
      headers: { authorization: AUTH },
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
      headers: { authorization: AUTH },
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
