import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BridgeConfig } from "../src/config/types.ts";
import { assertNoSensitivePricingFields } from "../src/offers/decide-response.ts";
import { buildApp } from "../src/server/build-app.ts";
import { TmsClient } from "../src/tms/client.ts";
import { FakeTmsServer } from "../src/tms/fake/server.ts";

const TOKEN = "t-decide-workflow";
const AUTH = "Bearer test-bridge-key-12345678";
const LOAD = "LD0000045821";

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

type TwinBody = Record<string, unknown>;

function twinPayload(overrides: TwinBody = {}): TwinBody {
  return {
    action: "negotiate",
    load_id: LOAD,
    carrier_counter: "",
    otp_status: "passed",
    current_load_id: "",
    rounds_used: 0,
    standing_offer: null,
    agreed_rate: null,
    outcome: "abandoned",
    ...overrides,
  };
}

function expectEnvelope(body: Record<string, unknown>): void {
  expect(body).toHaveProperty("agent");
  expect(body).toHaveProperty("calls");
  expect(body).toHaveProperty("offer");
  assertNoSensitivePricingFields(JSON.stringify(body));
}

describe("POST /v1/offers/decide workflow contract", () => {
  let app: FastifyInstance;
  let closeFake: () => Promise<void>;

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
  });

  afterAll(async () => {
    await app.close();
    await closeFake();
  });

  it("opening on negotiate with empty counter", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: twinPayload(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expectEnvelope(body);
    const agent = body.agent as Record<string, unknown>;
    const calls = body.calls as Record<string, unknown>;
    expect(agent.decision).toBe("OPENING");
    expect(agent.broker_offer).toBe(1950);
    expect(agent.rounds_remaining).toBe(3);
    expect(calls.current_load_id).toBe(LOAD);
    expect(calls.rounds_used).toBe(0);
    expect(calls.standing_offer).toBe(1950);
    expect(body.offer).not.toBeNull();
  });

  it("re-pitches standing offer on same load without reset", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: twinPayload({
        current_load_id: LOAD,
        rounds_used: 1,
        standing_offer: 1775,
        carrier_counter: "",
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const agent = body.agent as Record<string, unknown>;
    const calls = body.calls as Record<string, unknown>;
    expect(agent.decision).toBe("COUNTER");
    expect(agent.broker_offer).toBe(1775);
    expect(agent.rounds_remaining).toBe(2);
    expect(calls.rounds_used).toBe(1);
    expect(calls.standing_offer).toBe(1775);
  });

  it("counter cleans $ and commas and advances rounds_used", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: twinPayload({
        current_load_id: LOAD,
        rounds_used: 0,
        standing_offer: 1950,
        carrier_counter: "$2,200",
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const agent = body.agent as Record<string, unknown>;
    const calls = body.calls as Record<string, unknown>;
    expect(agent.decision).toBe("COUNTER");
    expect(agent.broker_offer as number).toBeLessThanOrEqual(1950);
    expect(agent.broker_offer as number).toBeGreaterThan(0);
    expect(calls.rounds_used).toBe(1);
  });

  it("invalid counter format returns INVALID_COUNTER", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: twinPayload({ carrier_counter: "not-a-rate" }),
    });
    expect(res.statusCode).toBe(200);
    const agent = (res.json() as { agent: { decision: string } }).agent;
    expect(agent.decision).toBe("INVALID_COUNTER");
  });

  it("three carrier counters then FINAL_REJECT on the third counter", async () => {
    let rounds_used = 0;
    let standing_offer: number | null = null;
    let current_load_id = "";

    const open = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: twinPayload(),
    });
    const openBody = open.json() as { calls: { standing_offer: number; current_load_id: string } };
    standing_offer = openBody.calls.standing_offer;
    current_load_id = openBody.calls.current_load_id;

    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/offers/decide",
        headers: { authorization: AUTH },
        payload: twinPayload({
          current_load_id,
          rounds_used,
          standing_offer,
          carrier_counter: "2200",
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        agent: { decision: string };
        calls: { rounds_used: number; standing_offer: number | null };
      };
      expect(body.agent.decision).toBe("COUNTER");
      rounds_used = body.calls.rounds_used;
      standing_offer = body.calls.standing_offer;
    }

    expect(rounds_used).toBe(2);

    const third = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: twinPayload({
        current_load_id,
        rounds_used,
        standing_offer,
        carrier_counter: "2200",
      }),
    });
    expect(third.statusCode).toBe(200);
    const thirdBody = third.json() as {
      agent: { decision: string };
      calls: { outcome: string; rounds_used: number };
    };
    expect(thirdBody.agent.decision).toBe("FINAL_REJECT");
    expect(thirdBody.calls.outcome).toBe("failed_negotiation");
    expect(thirdBody.calls.rounds_used).toBe(3);
  });

  it("FINAL_REJECT when rounds_used already 3 (no TMS)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: twinPayload({
        current_load_id: LOAD,
        rounds_used: 3,
        standing_offer: 1900,
        carrier_counter: "2000",
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const agent = body.agent as Record<string, unknown>;
    const calls = body.calls as Record<string, unknown>;
    expect(agent.decision).toBe("FINAL_REJECT");
    expect(calls.outcome).toBe("failed_negotiation");
    expect(calls.rounds_used).toBe(3);
  });

  it("accept with standing_offer", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: twinPayload({
        action: "accept",
        load_id: LOAD,
        current_load_id: LOAD,
        rounds_used: 0,
        standing_offer: 1950,
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const agent = body.agent as Record<string, unknown>;
    const calls = body.calls as Record<string, unknown>;
    expect(agent.decision).toBe("ACCEPT");
    expect(agent.agreed_rate).toBe(1950);
    expect(calls.agreed_rate).toBe(1950);
    expect(calls.outcome).toBe("agreed");
    expect(calls.rounds_used).toBe(0);
  });

  it("accept without standing_offer → NO_OFFER", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: twinPayload({
        action: "accept",
        load_id: LOAD,
        current_load_id: LOAD,
        standing_offer: "",
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect((body.agent as { decision: string }).decision).toBe("NO_OFFER");
    expect(body.offer).toBeNull();
  });

  it("NOT_VERIFIED when otp_status is not passed", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: twinPayload({ otp_status: "pending" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect((body.agent as { decision: string }).decision).toBe("NOT_VERIFIED");
    expect(body.offer).toBeNull();
  });

  it("unknown load → 200 LOAD_UNAVAILABLE", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: twinPayload({ load_id: "LD_DOES_NOT_EXIST_999" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect((body.agent as { decision: string }).decision).toBe("LOAD_UNAVAILABLE");
    expect(body.offer).toBeNull();
  });
});
