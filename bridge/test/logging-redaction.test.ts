import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BridgeConfig } from "../src/config/types.ts";
import { buildApp } from "../src/server/build-app.ts";
import { TmsClient } from "../src/tms/client.ts";
import { FakeTmsServer } from "../src/tms/fake/server.ts";

const TOKEN = "t-log-redact";
const AUTH = "Bearer test-bridge-key-12345678";
/** Fake fixture: posted RATE 2150 > MAX_BUY 1950 */
const INVERTED_LOAD = "LD0000045821";

const testConfig: BridgeConfig = {
  appEnv: "development",
  port: 8080,
  logLevel: "warn",
  bridgeApiKey: "test-bridge-key-12345678",
  tmsHost: "127.0.0.1",
  tmsPort: 1,
  tmsToken: TOKEN,
  fmcsaApiKey: "x",
};

describe("logging redaction", () => {
  let app: FastifyInstance;
  let closeFake: () => Promise<void>;
  const logLines: string[] = [];

  beforeAll(async () => {
    const fake = new FakeTmsServer({ token: TOKEN });
    const started = await fake.listen(0);
    closeFake = started.close;
    testConfig.tmsPort = started.port;
    const tms = new TmsClient({
      host: "127.0.0.1",
      port: started.port,
      token: TOKEN,
      responseMs: 800,
    });
    app = await buildApp(testConfig, { tms });
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
      headers: { authorization: AUTH, "x-hr-run-id": "run-log-1" },
      payload: {
        action: "negotiate",
        load_id: INVERTED_LOAD,
        carrier_counter: "",
        otp_status: "passed",
        current_load_id: "",
        rounds_used: 0,
        standing_offer: null,
        agreed_rate: null,
        outcome: "agreed",
      },
    });
    expect(res.statusCode).toBe(200);
    const blob = logLines.join("\n");
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
