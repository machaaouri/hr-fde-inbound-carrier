import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BridgeConfig } from "../src/config/types.ts";
import { buildApp } from "../src/server/build-app.ts";
import { TmsClient } from "../src/tms/client.ts";
import { FakeTmsServer } from "../src/tms/fake/server.ts";
import { parseDecideWorkflowInput } from "../src/offers/parse-decide-body.ts";
import {
  deriveNegotiationFromHistory,
  type OfferHistoryRow,
} from "../src/twin/workflow-fields.ts";

const TOKEN = "t-source";
const AUTH = "Bearer test-bridge-key-12345678";
const LOAD = "LD0000045821";
const OTHER = "LD0000045903";

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

type Body = Record<string, unknown>;

function legacyTwin(overrides: Body = {}): Body {
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

function withHistory(legacy: Body, rows: OfferHistoryRow[]): Body {
  const { rounds_used, standing_offer, ...rest } = legacy;
  return {
    ...rest,
    rounds_used,
    standing_offer,
    offers_history: rows,
  };
}

describe("source-of-truth inputs (offers_history + otp_challenge_status)", () => {
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

  async function post(payload: Body) {
    return app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH, "x-hr-run-id": "run-src" },
      payload,
    });
  }

  it("derive: repeat round rows do not inflate rounds_used", () => {
    const rows: OfferHistoryRow[] = [
      { load_id: LOAD, round: 0, carrier_counter: null, broker_offer: 1950, decision: "OPENING" },
      { load_id: LOAD, round: 1, carrier_counter: 2200, broker_offer: 1775, decision: "COUNTER" },
      { load_id: LOAD, round: 1, carrier_counter: null, broker_offer: 1775, decision: "COUNTER" },
    ];
    expect(deriveNegotiationFromHistory(LOAD, rows)).toEqual({
      rounds_used: 1,
      standing_offer: 1775,
      latest_broker_offer: 1775,
    });
  });

  it("derive: ignores rows for other loads", () => {
    const rows: OfferHistoryRow[] = [
      { load_id: OTHER, round: 3, carrier_counter: null, broker_offer: 9999, decision: "COUNTER" },
      { load_id: LOAD, round: 0, carrier_counter: null, broker_offer: 1950, decision: "OPENING" },
    ];
    expect(deriveNegotiationFromHistory(LOAD, rows).rounds_used).toBe(0);
    expect(deriveNegotiationFromHistory(LOAD, rows).standing_offer).toBe(1950);
  });

  it("opening: legacy and offers_history match", async () => {
    const legacy = legacyTwin();
    const leg = await post(legacy);
    const src = await post(
      withHistory(legacyTwin(), [
        {
          load_id: LOAD,
          round: 0,
          carrier_counter: null,
          broker_offer: 1950,
          decision: "OPENING",
        },
      ]),
    );
    expect(leg.statusCode).toBe(200);
    expect(src.statusCode).toBe(200);
    expect(leg.json().agent).toEqual(src.json().agent);
    expect(leg.json().calls).toEqual(src.json().calls);
  });

  it("counter: legacy and history-equivalent match", async () => {
    const open = await post(legacyTwin());
    const standing = open.json().calls.standing_offer as number;
    const legacy = legacyTwin({
      current_load_id: LOAD,
      rounds_used: 0,
      standing_offer: standing,
      carrier_counter: "2200",
    });
    const leg = await post(legacy);
    const src = await post(
      withHistory(legacy, [
        {
          load_id: LOAD,
          round: 0,
          carrier_counter: null,
          broker_offer: standing,
          decision: "OPENING",
        },
      ]),
    );
    expect(leg.json().agent).toEqual(src.json().agent);
    expect(leg.json().calls.rounds_used).toBe(1);
  });

  it("FINAL_REJECT when history shows round 3 and carrier counters again", async () => {
    const res = await post(
      withHistory(
        legacyTwin({
          current_load_id: LOAD,
          rounds_used: 3,
          standing_offer: 1900,
          carrier_counter: "2200",
        }),
        [
          { load_id: LOAD, round: 3, carrier_counter: 2200, broker_offer: 1900, decision: "COUNTER" },
        ],
      ),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().agent.decision).toBe("FINAL_REJECT");
  });

  it("accept at latest broker_offer from history", async () => {
    const res = await post({
      action: "accept",
      load_id: LOAD,
      carrier_counter: "",
      otp_status: "passed",
      current_load_id: LOAD,
      rounds_used: 0,
      standing_offer: 1775,
      agreed_rate: null,
      outcome: "abandoned",
      offers_history: [
        { load_id: LOAD, round: 0, carrier_counter: null, broker_offer: 1950, decision: "OPENING" },
        { load_id: LOAD, round: 1, carrier_counter: 2200, broker_offer: 1775, decision: "COUNTER" },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().agent.decision).toBe("ACCEPT");
    expect(res.json().agent.agreed_rate).toBe(1775);
  });

  it("accept at wrong price → 422 with history", async () => {
    const res = await post({
      action: "accept",
      load_id: LOAD,
      carrier_counter: "",
      otp_status: "passed",
      current_load_id: LOAD,
      standing_offer: 1900,
      offers_history: [
        { load_id: LOAD, round: 1, carrier_counter: 2200, broker_offer: 1775, decision: "COUNTER" },
      ],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("RATE_NOT_ACCEPTABLE");
  });

  it("legacy accept still allows round>0 standing within ceiling (legacy trust)", async () => {
    const res = await post({
      action: "accept",
      load_id: LOAD,
      carrier_counter: "",
      otp_status: "passed",
      current_load_id: LOAD,
      rounds_used: 2,
      standing_offer: 1900,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().agent.decision).toBe("ACCEPT");
  });

  it("NOT_VERIFIED via otp_challenge_status", async () => {
    const res = await post({
      ...legacyTwin(),
      otp_status: "passed",
      otp_challenge_status: "pending",
    });
    expect(res.json().agent.decision).toBe("NOT_VERIFIED");
  });

  it("precedence warning when legacy disagrees with history", () => {
    const parsed = parseDecideWorkflowInput({
      action: "negotiate",
      load_id: LOAD,
      carrier_counter: "",
      otp_status: "passed",
      rounds_used: 0,
      standing_offer: 1950,
      offers_history: [
        { load_id: LOAD, round: 1, carrier_counter: null, broker_offer: 1775, decision: "COUNTER" },
      ],
    });
    expect(parsed.precedenceWarnings).toContain("rounds_used");
    expect(parsed.inputStyle).toBe("source");
    expect(parsed.rounds_used).toBe(1);
  });

  it("booking: otp_challenge_status passed proceeds", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: AUTH },
      payload: {
        load_id: LOAD,
        mc_number: "136818",
        agreed_rate: 1900,
        run_id: "run-1",
        otp_challenge_status: "passed",
        outcome: "agreed",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().agent.status).toBe("BOOKED");
  });

  it("booking: otp_challenge_status not passed → NOT_READY", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: AUTH },
      payload: {
        load_id: LOAD,
        mc_number: "136818",
        agreed_rate: 1900,
        run_id: "run-1",
        otp_challenge_status: "pending",
        otp_status: "passed",
        outcome: "agreed",
      },
    });
    expect(res.json().agent.status).toBe("NOT_READY");
  });
});
