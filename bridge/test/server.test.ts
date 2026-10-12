import type { BridgeConfig } from "../src/config/types.ts";
import type { FastifyInstance } from "fastify";
import type { SearchLoadsResponse } from "../src/loads/safe-load-types.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/server/build-app.ts";
import { TmsClient } from "../src/tms/client.ts";
import { FakeTmsServer } from "./fake-tms/server.ts";

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

  it("GET /health is open", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
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

describe("logRouteOutcome", () => {
  it("emits one route outcome line with request_id and hr_run_id", async () => {
    const lines: unknown[] = [];
    const { default: Fastify } = await import("fastify");
    const { logRouteOutcome, setRouteOutcome } = await import("../src/http/route-log.ts");
    const app = Fastify({
      logger: {
        level: "info",
        stream: {
          write(chunk: string) {
            lines.push(JSON.parse(chunk));
          },
        },
      },
    });
    const req = {
      log: app.log,
      ctx: {
        requestId: "req-test-abc",
        hrRunId: "run-outcome-1",
        startedAtMs: performance.now(),
        tmsMs: 0,
      },
    } as import("fastify").FastifyRequest;
    setRouteOutcome(req, { endpoint: "health", status: "ok" });
    logRouteOutcome(req.log, req);
    await app.close();

    const outcome = lines.filter(
      (row) => (row as { msg?: string }).msg === "route outcome",
    );
    expect(outcome).toHaveLength(1);
    const payload = outcome[0] as {
      request_id: string;
      hr_run_id: string;
      endpoint: string;
    };
    expect(payload.hr_run_id).toBe("run-outcome-1");
    expect(payload.request_id).toBe("req-test-abc");
    expect(JSON.stringify(payload)).not.toMatch(/max_rate|otp_code|code_hash|salt/i);
  });
});


const LOG_REDACT_TOKEN = "t-log-redact";
const LOG_BRIDGE_AUTH = "Bearer test-bridge-key-12345678";
/** Fake fixture: posted RATE 2150 > MAX_BUY 1950 */
const INVERTED_LOAD = "LD0000045821";

const logRedactConfig: BridgeConfig = {
  appEnv: "development",
  port: 8080,
  logLevel: "warn",
  bridgeApiKey: "test-bridge-key-12345678",
  tmsHost: "127.0.0.1",
  tmsPort: 1,
  tmsToken: LOG_REDACT_TOKEN,
  fmcsaApiKey: "x",
};

describe("logging redaction", () => {
  let app: FastifyInstance;
  let closeFake: () => Promise<void>;
  const logLines: string[] = [];

  beforeAll(async () => {
    const fake = new FakeTmsServer({ token: LOG_REDACT_TOKEN });
    const started = await fake.listen(0);
    closeFake = started.close;
    const cfg = { ...logRedactConfig, tmsPort: started.port };
    const tms = new TmsClient({
      host: "127.0.0.1",
      port: started.port,
      token: LOG_REDACT_TOKEN,
      responseMs: 800,
    });
    app = await buildApp(cfg, { tms });
    app.log.warn = ((fields: unknown, msg?: string) => {
      logLines.push(JSON.stringify({ fields, msg }));
    }) as typeof app.log.warn;
    app.log.info = ((fields: unknown, msg?: string) => {
      logLines.push(JSON.stringify({ fields, msg }));
    }) as typeof app.log.info;
  });

  afterAll(async () => {
    await app.close();
    await closeFake();
  });

  it("never logs max_rate / maxBuy when loadboard exceeds ceiling on negotiate opening", async () => {
    logLines.length = 0;
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: LOG_BRIDGE_AUTH, "x-hr-run-id": "run-log-1" },
      payload: {
        action: "negotiate",
        load_id: INVERTED_LOAD,
        carrier_counter: "",
        otp_challenge_status: "passed",
        current_load_id: "",
        offers_history: [],
      },
    });
    expect(res.statusCode).toBe(200);
    for (const line of logLines) {
      const parsed = JSON.parse(line) as { fields?: Record<string, unknown>; msg?: string };
      const fields = parsed.fields ?? {};
      expect(fields).not.toHaveProperty("max_rate");
      expect(fields).not.toHaveProperty("maxBuy");
      expect(fields).not.toHaveProperty("max_buy");
      expect(JSON.stringify(fields)).not.toContain("1950");
    }
  });
});
