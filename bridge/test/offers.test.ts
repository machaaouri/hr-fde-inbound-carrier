import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import type { FastifyInstance } from "fastify";
import type { BridgeConfig } from "../src/config/types.ts";
import type { OfferHistoryRow } from "../src/http/workflow-request-fields.ts";
import {
  agreedRateFromAcceptHistory,
  deriveNegotiationFromHistory,
} from "../src/http/workflow-request-fields.ts";
import { buildApp } from "../src/server/build-app.ts";
import { decideOfferForWorkflow } from "../src/offers/decide-service.ts";
import { assertNoSensitivePricingFields } from "../src/offers/decide-types.ts";
import {
  decideLogRound,
  parseCarrierCounterRaw,
  parseDecideWorkflowInput,
  parseTwinDollarField,
} from "../src/offers/parse-decide-body.ts";
import {
  closeGapAcceptThreshold,
  computeOpeningOffer,
  counterStepSize,
  decideOffer,
  floor25,
  isLoadboardAboveMax,
  isWithinCloseGap,
  nextBrokerCounterOffer,
  roundDownToStep,
} from "../src/offers/policy.ts";
import { TmsClient } from "../src/tms/client.ts";
import { FakeTmsServer } from "./fake-tms/server.ts";

/** LD00923-style: loadboard below ceiling. */
const NORMAL = { postedRate: 821, maxBuy: 950 };

/** Handbook fake: posted above ceiling. */
const INVERTED = { postedRate: 2150, maxBuy: 1950 };

describe("opening = loadboard_rate", () => {
  it("opens at posted rate when below max", () => {
    expect(computeOpeningOffer(NORMAL)).toBe(821);
    const out = decideOffer({
      round: 0,
      pricing: NORMAL,
      loadAvailable: true,
    });
    expect(out.broker_offer).toBe(821);
  });

  it("opens at max_rate when loadboard exceeds max", () => {
    expect(isLoadboardAboveMax(INVERTED)).toBe(true);
    expect(computeOpeningOffer(INVERTED)).toBe(1950);
  });
});

describe("counter rounds", () => {
  it("accepts counter at or below current broker offer", () => {
    const out = decideOffer({
      round: 1,
      pricing: NORMAL,
      carrierCounter: 800,
      previousBrokerOffer: 821,
      loadAvailable: true,
    });
    expect(out.decision).toBe("ACCEPT");
    expect(out.agreed_rate).toBe(800);
  });

  it("accepts counter equal to current offer", () => {
    const out = decideOffer({
      round: 1,
      pricing: NORMAL,
      carrierCounter: 821,
      previousBrokerOffer: 821,
      loadAvailable: true,
    });
    expect(out.decision).toBe("ACCEPT");
    expect(out.agreed_rate).toBe(821);
  });

  it("broker counters move up toward carrier without exceeding max or counter", () => {
    const b1 = nextBrokerCounterOffer(821, 900, 950, 1);
    expect(b1).toBeGreaterThan(821);
    expect(b1).toBeLessThanOrEqual(900);
    expect(b1).toBeLessThan(950);

    const b2 = nextBrokerCounterOffer(b1, 940, 950, 2);
    expect(b2).toBeGreaterThanOrEqual(b1);
    expect(b2).toBeLessThanOrEqual(940);
    expect(b2).toBeLessThan(950);
  });

  it("never publishes max_rate on counter offers", () => {
    for (let round = 1; round <= 3; round++) {
      const offer = nextBrokerCounterOffer(821, 5000, 950, round);
      expect(offer).toBeLessThan(950);
    }
  });

  it("monotonic broker offers across three counter rounds", () => {
    let previous = 821;
    const carrier = 940;
    const offers: number[] = [];
    for (let round = 1; round <= 3; round++) {
      const b = nextBrokerCounterOffer(previous, carrier, 950, round);
      offers.push(b);
      previous = b;
    }
    expect(offers[0]).toBeLessThan(offers[1]);
    expect(offers[1]).toBeLessThanOrEqual(offers[2]);
    for (const o of offers) {
      expect(o).toBeLessThan(950);
    }
  });

  it("FINAL_REJECT on round 3 when still apart", () => {
    const out = decideOffer({
      round: 3,
      pricing: NORMAL,
      carrierCounter: 940,
      previousBrokerOffer: 875,
      loadAvailable: true,
    });
    expect(out.decision).toBe("FINAL_REJECT");
    expect(out.rounds_remaining).toBe(0);
  });

  it("INVALID_COUNTER for non-positive values", () => {
    const out = decideOffer({
      round: 1,
      pricing: NORMAL,
      carrierCounter: 0,
      previousBrokerOffer: 821,
      loadAvailable: true,
    });
    expect(out.decision).toBe("INVALID_COUNTER");
  });
});

describe("responses never embed ceiling", () => {
  it("JSON from decideOffer omits max_buy", () => {
    const out = decideOffer({
      round: 1,
      pricing: INVERTED,
      carrierCounter: 2200,
      previousBrokerOffer: 1950,
      loadAvailable: true,
    });
    expect(JSON.stringify(out)).not.toMatch(/max_buy|maxBuy|1950.*1950/i);
    expect(out.broker_offer ?? out.agreed_rate ?? 0).toBeLessThanOrEqual(2200);
    if (out.broker_offer !== undefined) {
      expect(out.broker_offer).toBeLessThanOrEqual(INVERTED.maxBuy);
    }
  });
});

describe("floor25", () => {
  it("rounds down to $25", () => {
    expect(floor25(852)).toBe(850);
  });
});

describe("close gap accept (posted $1,524 / counter $1,550)", () => {
  const GREENSBORO = { postedRate: 1524, maxBuy: 1700 };

  it("threshold is max($50, 3%)", () => {
    expect(closeGapAcceptThreshold(1524)).toBe(50);
    expect(isWithinCloseGap(1524, 1550)).toBe(true);
    expect(isWithinCloseGap(1524, 1575)).toBe(false);
  });

  it("accepts $1,550 instead of a $1-style broker counter", () => {
    const out = decideOffer({
      round: 1,
      pricing: GREENSBORO,
      carrierCounter: 1550,
      previousBrokerOffer: 1524,
      loadAvailable: true,
    });
    expect(out.decision).toBe("ACCEPT");
    expect(out.agreed_rate).toBe(1550);
  });

  it("counters with a clean step well above $1,525 when gap is larger", () => {
    const out = decideOffer({
      round: 1,
      pricing: { postedRate: 1524, maxBuy: 1800 },
      carrierCounter: 1700,
      previousBrokerOffer: 1524,
      loadAvailable: true,
    });
    expect(out.decision).toBe("COUNTER");
    expect(out.broker_offer).toBe(1600);
    expect(out.broker_offer).toBeGreaterThan(1550);
  });
});

describe("step sizes and rounding", () => {
  it("uses $25 steps at or above $1,000 last quote", () => {
    expect(counterStepSize(1524)).toBe(25);
    expect(roundDownToStep(1612, 25)).toBe(1600);
  });

  it("uses $5 steps below $1,000 last quote", () => {
    expect(counterStepSize(821)).toBe(5);
    expect(nextBrokerCounterOffer(821, 900, 950, 1)).toBe(860);
  });
});

describe("ceiling concealment", () => {
  it("never publishes max_rate on counter offers", () => {
    for (let round = 1; round <= 3; round++) {
      const offer = nextBrokerCounterOffer(1524, 5000, 1700, round);
      expect(offer).toBeLessThan(1700);
    }
  });
});


describe("parseCarrierCounterRaw", () => {
  it("treats empty as opening", () => {
    expect(parseCarrierCounterRaw("")).toEqual({ kind: "empty" });
    expect(parseCarrierCounterRaw("   ")).toEqual({ kind: "empty" });
  });

  it("cleans currency strings", () => {
    expect(parseCarrierCounterRaw("$1,800")).toEqual({ kind: "ok", dollars: 1800 });
    expect(parseCarrierCounterRaw("1800.00")).toEqual({ kind: "ok", dollars: 1800 });
    expect(parseCarrierCounterRaw(" 2200 ")).toEqual({ kind: "ok", dollars: 2200 });
  });

  it("marks garbage invalid", () => {
    expect(parseCarrierCounterRaw("abc")).toEqual({ kind: "invalid" });
    expect(parseCarrierCounterRaw("0")).toEqual({ kind: "invalid" });
  });
});

describe("parseTwinDollarField", () => {
  it("parses twin nullable dollars", () => {
    expect(parseTwinDollarField(null)).toBeNull();
    expect(parseTwinDollarField("")).toBeNull();
    expect(parseTwinDollarField("1700")).toBe(1700);
    expect(parseTwinDollarField(1775)).toBe(1775);
  });
});

describe("parseDecideWorkflowInput", () => {
  it("normalizes v3 defaults", () => {
    const body = parseDecideWorkflowInput({
      action: "negotiate",
      load_id: "LD1",
      carrier_counter: "",
      otp_challenge_status: "passed",
      current_load_id: "",
    });
    expect(body.max_round).toBe(0);
    expect(body.latest_broker_offer).toBeNull();
    expect(body.offers_history).toEqual([]);
  });

  it("derives max_round from offers_history", () => {
    const body = parseDecideWorkflowInput({
      action: "negotiate",
      load_id: "LD1",
      current_load_id: "LD1",
      carrier_counter: "1800",
      otp_challenge_status: "passed",
      offers_history: [
        {
          load_id: "LD1",
          round: 1,
          carrier_counter: 2000,
          broker_offer: 1775,
          decision: "COUNTER",
        },
      ],
    });
    expect(body.max_round).toBe(1);
    expect(body.latest_broker_offer).toBe(1775);
  });

  it("decideLogRound for counter on same load", () => {
    const req = parseDecideWorkflowInput({
      action: "negotiate",
      load_id: "LD1",
      current_load_id: "LD1",
      carrier_counter: "1800",
      otp_challenge_status: "passed",
      offers_history: [
        { load_id: "LD1", round: 1, broker_offer: 1775, decision: "COUNTER" },
      ],
    });
    expect(decideLogRound(req, parseCarrierCounterRaw("1800"))).toBe(2);
  });
});

describe("negotiation policy wire safety", () => {
  it("OPENING equals loadboard_rate", () => {
    const raw = decideOffer({
      round: 0,
      pricing: NORMAL,
      loadAvailable: true,
    });
    expect(raw).toMatchObject({
      decision: "OPENING",
      broker_offer: 821,
      rounds_remaining: 3,
    });
    assertNoSensitivePricingFields(JSON.stringify(raw));
  });

  it("COUNTER stays below ceiling in JSON", () => {
    const raw = decideOffer({
      round: 1,
      pricing: NORMAL,
      carrierCounter: 900,
      previousBrokerOffer: 821,
      loadAvailable: true,
    });
    expect(raw.decision).toBe("COUNTER");
    expect(raw.broker_offer).toBeGreaterThan(821);
    expect(raw.broker_offer!).toBeLessThan(950);
    assertNoSensitivePricingFields(JSON.stringify(raw));
  });
});


const LOAD = "LD0000045821";

describe("offers_history derivation", () => {
  it("repeat round rows do not inflate max_round", () => {
    const rows: OfferHistoryRow[] = [
      {
        load_id: LOAD,
        round: 1,
        carrier_counter: 2200,
        broker_offer: 1775,
        decision: "COUNTER",
      },
      {
        load_id: LOAD,
        round: 1,
        carrier_counter: 2200,
        broker_offer: 1775,
        decision: "COUNTER",
      },
    ];
    expect(deriveNegotiationFromHistory(LOAD, rows).max_round).toBe(1);
  });

  it("latest broker_offer follows array order for the load", () => {
    const rows: OfferHistoryRow[] = [
      {
        load_id: LOAD,
        round: 0,
        carrier_counter: null,
        broker_offer: 1950,
        decision: "OPENING",
      },
      {
        load_id: LOAD,
        round: 1,
        carrier_counter: 2200,
        broker_offer: 1775,
        decision: "COUNTER",
      },
    ];
    expect(deriveNegotiationFromHistory(LOAD, rows).latest_broker_offer).toBe(1775);
  });

  it("agreedRateFromAcceptHistory prefers broker_offer then carrier_counter", () => {
    expect(
      agreedRateFromAcceptHistory(LOAD, [
        {
          load_id: LOAD,
          round: 1,
          carrier_counter: 850,
          broker_offer: null,
          decision: "ACCEPT",
        },
      ]),
    ).toBe(850);
    expect(
      agreedRateFromAcceptHistory(LOAD, [
        {
          load_id: LOAD,
          round: 1,
          carrier_counter: 850,
          broker_offer: 848,
          decision: "ACCEPT",
        },
      ]),
    ).toBe(848);
  });

  it("ignores rows for other loads", () => {
    const rows: OfferHistoryRow[] = [
      {
        load_id: "OTHER",
        round: 3,
        carrier_counter: null,
        broker_offer: 9999,
        decision: "OPENING",
      },
    ];
    expect(deriveNegotiationFromHistory(LOAD, rows)).toEqual({
      max_round: 0,
      latest_broker_offer: null,
    });
  });
});


const DECIDE_SERVICE_TOKEN = "t-decide-test";

const decideServiceConfig: BridgeConfig = {
  appEnv: "development",
  port: 8080,
  logLevel: "error",
  bridgeApiKey: "test-key",
  tmsHost: "127.0.0.1",
  tmsPort: 1,
  tmsToken: DECIDE_SERVICE_TOKEN,
  fmcsaApiKey: "x",
};

describe("decideOfferForWorkflow (fake TMS)", () => {
  let fake: FakeTmsServer;
  let client: TmsClient;
  let closeFake: () => Promise<void>;

  beforeEach(async () => {
    fake = new FakeTmsServer({ token: DECIDE_SERVICE_TOKEN });
    const started = await fake.listen(0);
    closeFake = started.close;
    client = new TmsClient({
      host: "127.0.0.1",
      port: started.port,
      token: DECIDE_SERVICE_TOKEN,
      responseMs: 800,
    });
  });

  afterEach(async () => {
    await closeFake();
  });

  it("logs when loadboard exceeds max on opening", async () => {
    const warnings: string[] = [];
    await decideOfferForWorkflow(
      client,
      decideServiceConfig,
      {
        action: "negotiate",
        load_id: "LD0000045821",
        carrier_counter: "",
        otp_challenge_status: "passed",
        current_load_id: "",
        offers_history: [],
        max_round: 0,
        latest_broker_offer: null,
      },
      {
        warn: (_fields, message) => warnings.push(message),
      },
    );
    expect(warnings.some((m) => m.includes("loadboard_rate exceeds ceiling"))).toBe(
      true,
    );
  });

  it("returns OPENING at clamped loadboard for handbook load", async () => {
    const out = await decideOfferForWorkflow(client, decideServiceConfig, {
      action: "negotiate",
      load_id: "LD0000045821",
      carrier_counter: "",
      otp_challenge_status: "passed",
      current_load_id: "",
      offers_history: [],
      max_round: 0,
      latest_broker_offer: null,
    });
    expect(out.agent).toEqual({
      decision: "OPENING",
      broker_offer: 1950,
      agreed_rate: null,
      rounds_remaining: 3,
    });
    expect(JSON.stringify(out)).not.toMatch(/max_buy|MAX_BUY/i);
  });
});


const WORKFLOW_TOKEN = "t-decide-workflow";
const WORKFLOW_AUTH = "Bearer test-bridge-key-12345678";

const workflowTestConfig: BridgeConfig = {
  appEnv: "development",
  port: 8080,
  logLevel: "error",
  bridgeApiKey: "test-bridge-key-12345678",
  tmsHost: "127.0.0.1",
  tmsPort: 1,
  tmsToken: WORKFLOW_TOKEN,
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
    const fake = new FakeTmsServer({ token: WORKFLOW_TOKEN });
    const started = await fake.listen(0);
    closeFake = started.close;
    const cfg = { ...workflowTestConfig, tmsPort: started.port };
    const tms = new TmsClient({
      host: "127.0.0.1",
      port: started.port,
      token: WORKFLOW_TOKEN,
      responseMs: 800,
    });
    app = await buildApp(cfg, { tms });
  });

  afterAll(async () => {
    await app.close();
    await closeFake();
  });

  it("opening on negotiate with empty counter", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: WORKFLOW_AUTH },
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
      headers: { authorization: WORKFLOW_AUTH },
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
      headers: { authorization: WORKFLOW_AUTH },
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
      headers: { authorization: WORKFLOW_AUTH },
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
      headers: { authorization: WORKFLOW_AUTH },
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
        headers: { authorization: WORKFLOW_AUTH },
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
      headers: { authorization: WORKFLOW_AUTH },
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
      headers: { authorization: WORKFLOW_AUTH },
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
      headers: { authorization: WORKFLOW_AUTH },
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
      headers: { authorization: WORKFLOW_AUTH },
      payload: decidePayload({ load_id: LD, offers_history: [] }),
    });
    expect(open.statusCode).toBe(200);
    expect(open.json().agent.broker_offer).toBe(821);

    const counter = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: WORKFLOW_AUTH },
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
      headers: { authorization: WORKFLOW_AUTH },
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
      headers: { authorization: WORKFLOW_AUTH },
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
      headers: { authorization: WORKFLOW_AUTH },
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
      headers: { authorization: WORKFLOW_AUTH },
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
      headers: { authorization: WORKFLOW_AUTH },
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
      headers: { authorization: WORKFLOW_AUTH },
      payload: { ...decidePayload(), twin_echo: "ignored" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { agent: { decision: string } }).agent.decision).toBe("OPENING");
  });
});
