import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BridgeConfig } from "../src/config/types.ts";
import type { SearchLoadsResponse } from "../src/loads/safe-load-types.ts";
import { buildApp } from "../src/server/build-app.ts";
import { TmsClient } from "../src/tms/client.ts";
import { FakeTmsServer } from "../src/tms/fake/server.ts";

const TMS_TOKEN = "t-test";

const testConfig: BridgeConfig = {
  appEnv: "development",
  port: 8080,
  logLevel: "error",
  bridgeApiKey: "test-bridge-key-12345678",
  tmsHost: "127.0.0.1",
  tmsPort: 1,
  tmsToken: TMS_TOKEN,
  fmcsaApiKey: "fmcsa-test",
};

describe("bridge HTTP", () => {
  let app: FastifyInstance;
  let closeFake: () => Promise<void>;

  beforeAll(async () => {
    const fake = new FakeTmsServer({ token: TMS_TOKEN });
    const started = await fake.listen(0);
    testConfig.tmsPort = started.port;
    closeFake = started.close;
    const tms = new TmsClient({
      host: "127.0.0.1",
      port: started.port,
      token: TMS_TOKEN,
      responseMs: 800,
    });
    app = await buildApp(testConfig, { tms });
  });

  afterAll(async () => {
    await app.close();
    await closeFake();
  });

  it("GET /healthz is open", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("POST /v1/loads/search requires auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/loads/search",
      payload: { equipment_type: "DRY_VAN" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("POST /v1/loads/search returns safe live loads from TMS", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/loads/search",
      headers: {
        authorization: "Bearer test-bridge-key-12345678",
        "x-hr-run-id": "run-test-1",
      },
      payload: { equipment_type: "DRY_VAN", origin_state: "GA", dest_state: "TX" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SearchLoadsResponse;
    expect(body.loads.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/max_buy|MAX_BUY|ceiling/i);
    expect(body.loads[0]?.loadboard_rate).toBeGreaterThan(0);
  });

  it("POST /v1/loads/search accepts empty optional strings from workflow", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/loads/search",
      headers: { authorization: "Bearer test-bridge-key-12345678" },
      payload: {
        equipment_type: "DRY_VAN",
        origin_state: "",
        dest_state: "",
        origin_city: "",
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /v1/loads/search rejects invalid state with 422", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/loads/search",
      headers: { authorization: "Bearer test-bridge-key-12345678" },
      payload: { equipment_type: "DRY_VAN", origin_state: "Georgia" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});
