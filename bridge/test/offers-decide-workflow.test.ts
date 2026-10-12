import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BridgeConfig } from "../src/config/types.ts";
import { assertNoSensitivePricingFields } from "../src/offers/decide-response.ts";
import { buildApp } from "../src/server/build-app.ts";
import { TmsClient } from "../src/tms/client.ts";
import { FakeTmsServer } from "../src/tms/fake/server.ts";
import type { OfferHistoryRow } from "../src/twin/workflow-fields.ts";

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

type DecideBody = Record<string, unknown>;

function decidePayload(overrides: DecideBody = {}): DecideBody {
  return {
    action: "negotiate",
    load_id: LOAD,
    carrier_counter: "",
    current_load_id: "",
    otp_challenge_status: "passed",
    offers_history: [],
    ...overrides,
  };
}

function historyRows(rows: OfferHistoryRow[]): OfferHistoryRow[] {
  return rows;
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
      payload: decidePayload(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expectEnvelope(body);
    const agent = body.agent as Record<string, unknown>;
    const calls = body.calls as Record<string, unknown>;
    expect(agent.decision).toBe("OPENING");
    expect(agent.broker_offer).toBe(1950);
    expect(agent.rounds_remaining).toBe(3);
    expect(calls).toEqual({ current_load_id: LOAD });
    expect(body.offer).not.toBeNull();
  });

  it("re-pitches latest broker offer from history on same load", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: decidePayload({
        current_load_id: LOAD,
        carrier_counter: "",
        offers_history: historyRows([
          {
            load_id: LOAD,
            round: 1,
            carrier_counter: 2200,
            broker_offer: 1775,
            decision: "COUNTER",
          },
        ]),
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const agent = body.agent as Record<string, unknown>;
    const calls = body.calls as Record<string, unknown>;
    expect(agent.decision).toBe("COUNTER");
    expect(agent.broker_offer).toBe(1775);
    expect(agent.rounds_remaining).toBe(2);
    expect(calls).toEqual({ current_load_id: LOAD });
  });

  it("counter cleans $ and commas", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: decidePayload({
        current_load_id: LOAD,
        carrier_counter: "$2,200",
        offers_history: historyRows([
          {
            load_id: LOAD,
            round: 0,
            carrier_counter: null,
            broker_offer: 1950,
            decision: "OPENING",
          },
        ]),
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const agent = body.agent as Record<string, unknown>;
    expect(agent.decision).toBe("COUNTER");
    expect(agent.broker_offer).toBe(1900);
  });

  it("invalid counter format returns INVALID_COUNTER", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: decidePayload({ carrier_counter: "not-a-rate" }),
    });
    expect(res.statusCode).toBe(200);
    const agent = (res.json() as { agent: { decision: string } }).agent;
    expect(agent.decision).toBe("INVALID_COUNTER");
  });

  it("three carrier counters then FINAL_REJECT on the third counter", async () => {
    let offers_history: OfferHistoryRow[] = [];
    let current_load_id = LOAD;

    const open = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: decidePayload(),
    });
    const openBody = open.json() as {
      agent: { broker_offer: number; decision: string };
      offer: OfferHistoryRow;
    };
    offers_history = [
      {
        load_id: LOAD,
        round: 0,
        carrier_counter: null,
        broker_offer: openBody.agent.broker_offer,
        decision: openBody.agent.decision,
      },
    ];

    for (let round = 1; round <= 2; round++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/offers/decide",
        headers: { authorization: AUTH },
        payload: decidePayload({
          current_load_id,
          carrier_counter: "2200",
          offers_history,
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        agent: { decision: string; broker_offer: number | null };
        offer: OfferHistoryRow;
      };
      expect(body.agent.decision).toBe("COUNTER");
      offers_history = [
        ...offers_history,
        {
          load_id: LOAD,
          round: body.offer.round,
          carrier_counter: 2200,
          broker_offer: body.agent.broker_offer,
          decision: body.agent.decision,
        },
      ];
    }

    const third = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: decidePayload({
        current_load_id,
        carrier_counter: "2200",
        offers_history,
      }),
    });
    expect(third.statusCode).toBe(200);
    const thirdBody = third.json() as {
      agent: { decision: string };
      calls: { outcome: string };
    };
    expect(thirdBody.agent.decision).toBe("FINAL_REJECT");
    expect(thirdBody.calls.outcome).toBe("failed_negotiation");
  });

  it("FINAL_REJECT when history max round is 3 and carrier counters", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: decidePayload({
        current_load_id: LOAD,
        carrier_counter: "2000",
        offers_history: historyRows([
          {
            load_id: LOAD,
            round: 3,
            carrier_counter: 2200,
            broker_offer: 1900,
            decision: "COUNTER",
          },
        ]),
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const agent = body.agent as Record<string, unknown>;
    const calls = body.calls as Record<string, unknown>;
    expect(agent.decision).toBe("FINAL_REJECT");
    expect(calls.outcome).toBe("failed_negotiation");
  });

  it("accept uses latest broker_offer from history", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: decidePayload({
        action: "accept",
        current_load_id: LOAD,
        offers_history: historyRows([
          {
            load_id: LOAD,
            round: 0,
            carrier_counter: null,
            broker_offer: 1950,
            decision: "OPENING",
          },
        ]),
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const agent = body.agent as Record<string, unknown>;
    const calls = body.calls as Record<string, unknown>;
    expect(agent.decision).toBe("ACCEPT");
    expect(agent.agreed_rate).toBe(1950);
    expect(calls).toEqual({
      current_load_id: LOAD,
      agreed_rate: 1950,
      outcome: "agreed",
    });
    expect((body.offer as { broker_offer: number }).broker_offer).toBe(1950);
  });

  it("LD00983: counter 850 accepted then action accept stays at 850", async () => {
    const LD = "LD00983";
    const open = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: decidePayload({ load_id: LD, offers_history: [] }),
    });
    expect(open.statusCode).toBe(200);
    expect(open.json().agent.broker_offer).toBe(821);

    const counter = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: decidePayload({
        load_id: LD,
        current_load_id: LD,
        carrier_counter: "850",
        offers_history: historyRows([
          {
            load_id: LD,
            round: 0,
            carrier_counter: null,
            broker_offer: 821,
            decision: "OPENING",
          },
        ]),
      }),
    });
    expect(counter.statusCode).toBe(200);
    const counterBody = counter.json() as {
      agent: { decision: string; agreed_rate: number };
      offer: { broker_offer: number; decision: string };
    };
    expect(counterBody.agent.decision).toBe("ACCEPT");
    expect(counterBody.agent.agreed_rate).toBe(850);
    expect(counterBody.offer.broker_offer).toBe(850);

    const again = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: decidePayload({
        action: "accept",
        load_id: LD,
        current_load_id: LD,
        offers_history: historyRows([
          {
            load_id: LD,
            round: 0,
            carrier_counter: null,
            broker_offer: 821,
            decision: "OPENING",
          },
          {
            load_id: LD,
            round: 1,
            carrier_counter: 850,
            broker_offer: null,
            decision: "ACCEPT",
          },
        ]),
      }),
    });
    expect(again.statusCode).toBe(200);
    const againBody = again.json() as {
      agent: { decision: string; agreed_rate: number };
      calls: Record<string, unknown>;
      offer: unknown;
    };
    expect(againBody.agent.decision).toBe("ACCEPT");
    expect(againBody.agent.agreed_rate).toBe(850);
    expect(againBody.offer).toBeNull();
    expect(againBody.calls).toEqual({});
  });

  it("LD00983: action accept on opening history agrees at 821", async () => {
    const LD = "LD00983";
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: decidePayload({
        action: "accept",
        load_id: LD,
        current_load_id: LD,
        offers_history: historyRows([
          {
            load_id: LD,
            round: 0,
            carrier_counter: null,
            broker_offer: 821,
            decision: "OPENING",
          },
        ]),
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      agent: { decision: string; agreed_rate: number };
      offer: { broker_offer: number };
    };
    expect(body.agent.decision).toBe("ACCEPT");
    expect(body.agent.agreed_rate).toBe(821);
    expect(body.offer.broker_offer).toBe(821);
  });

  it("accept with empty history ? NO_OFFER", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: decidePayload({
        action: "accept",
        current_load_id: LOAD,
        offers_history: [],
      }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect((body.agent as { decision: string }).decision).toBe("NO_OFFER");
    expect(body.offer).toBeNull();
    expect(body.calls).toEqual({});
  });

  it("NOT_VERIFIED when otp_challenge_status is not passed", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: decidePayload({ otp_challenge_status: "pending" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect((body.agent as { decision: string }).decision).toBe("NOT_VERIFIED");
    expect(body.offer).toBeNull();
  });

  it("unknown load ? 200 LOAD_UNAVAILABLE", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: decidePayload({ load_id: "LD_DOES_NOT_EXIST_999" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect((body.agent as { decision: string }).decision).toBe("LOAD_UNAVAILABLE");
    expect(body.offer).toBeNull();
  });

  it("ignores unknown extra fields on request body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: { ...decidePayload(), twin_echo: "ignored" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { agent: { decision: string } }).agent.decision).toBe("OPENING");
  });
});
