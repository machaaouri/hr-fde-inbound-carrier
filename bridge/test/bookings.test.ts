import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BridgeConfig } from "../src/config/config.ts";
import { assertNoSensitivePricingFields } from "../src/bookings/booking-workflow.ts";
import { buildApp } from "../src/server/build-app.ts";
import { TmsClient } from "../src/tms/client.ts";
import { FakeTmsServer } from "./fake-tms/server.ts";

const TOKEN = "t-bookings";
const AUTH = "Bearer test-bridge-key-12345678";
const OPEN_LOAD = "LD0000045821";
const BOOKED_LOAD = "LD0000047000";

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

function readyPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    load_id: OPEN_LOAD,
    mc_number: "136818",
    agreed_rate: 1900,
    run_id: "run-book-1",
    otp_challenge_status: "passed",
    ...overrides,
  };
}

describe("POST /v1/bookings workflow", () => {
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
      responseMs: 800,
    });
    app = await buildApp(testConfig, { tms });
  });

  afterAll(async () => {
    await app.close();
    await closeFake();
  });

  it("504 on TMS timeout (no business envelope)", async () => {
    fake.setFault("timeout");
    const res = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: AUTH },
      payload: readyPayload({ load_id: "LD0000046999" }),
    });
    fake.setFault(null);
    expect(res.statusCode).toBe(504);
    expect(res.json().error.code).toBe("TMS_UNAVAILABLE");
  });

  it("NOT_READY when otp_challenge_status is not passed", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: AUTH },
      payload: readyPayload({ otp_challenge_status: "pending" }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      agent: { status: "NOT_READY", booking_ref: null },
      calls: {},
    });
  });

  it("NOT_READY when agreed_rate empty string", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: AUTH },
      payload: readyPayload({ agreed_rate: "" }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      agent: { status: "NOT_READY", booking_ref: null },
      calls: {},
    });
  });

  it("NOT_READY when otp_challenge_status passed but agreed_rate missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: AUTH },
      payload: {
        load_id: OPEN_LOAD,
        mc_number: "136818",
        run_id: "run-book-1",
        otp_challenge_status: "passed",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().agent.status).toBe("NOT_READY");
  });

  it("RATE_NOT_ACCEPTABLE on 200 when above ceiling", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: AUTH },
      payload: readyPayload({ load_id: "LD0000045903", agreed_rate: 2500 }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      agent: { status: "RATE_NOT_ACCEPTABLE", booking_ref: null },
      calls: {},
    });
  });

  it("LOAD_UNAVAILABLE when load already booked in TMS", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: AUTH },
      payload: readyPayload({ load_id: BOOKED_LOAD, agreed_rate: 1800 }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      agent: { status: "LOAD_UNAVAILABLE", booking_ref: null },
      calls: {},
    });
  });

  it("BOOKED when gates pass and rate within ceiling", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: AUTH },
      payload: readyPayload({ load_id: OPEN_LOAD, agreed_rate: 1900 }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    assertNoSensitivePricingFields(JSON.stringify(body));
    expect(body).toEqual({
      agent: { status: "BOOKED", booking_ref: `BR-${OPEN_LOAD}` },
      calls: { booking_ref: `BR-${OPEN_LOAD}`, outcome: "booked" },
    });
  });

  it("accepts agreed_rate as numeric string", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: AUTH },
      payload: readyPayload({ load_id: "LD0000045903", agreed_rate: "2000" }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().agent.status).toBe("BOOKED");
  });

  it("BOOKED_RECONCILED on duplicate book attempt", async () => {
    const payload = readyPayload({
      load_id: "LD0000046112",
      agreed_rate: 3000,
      run_id: "run-book-4",
    });
    const first = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: AUTH },
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().agent.status).toBe("BOOKED");

    const second = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: AUTH },
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      agent: { status: "BOOKED_RECONCILED", booking_ref: "BR-LD0000046112" },
      calls: { outcome: "booked" },
    });
  });
});


const NEGOTIATE_TOKEN = "t-neg-book";
const LOAD = "LD0000045821";

const negotiateTestConfig: BridgeConfig = {
  ...testConfig,
  tmsToken: NEGOTIATE_TOKEN,
};

describe("negotiate → accept → book (PENDING LOAD_BOOK wire)", () => {
  let app: FastifyInstance;
  let fake: FakeTmsServer;
  let closeFake: () => Promise<void>;

  beforeAll(async () => {
    fake = new FakeTmsServer({ token: NEGOTIATE_TOKEN });
    const started = await fake.listen(0);
    closeFake = started.close;
    const cfg = { ...negotiateTestConfig, tmsPort: started.port };
    const tms = new TmsClient({
      host: "127.0.0.1",
      port: started.port,
      token: NEGOTIATE_TOKEN,
      responseMs: 800,
    });
    app = await buildApp(cfg, { tms });
  });

  afterAll(async () => {
    await app.close();
    await closeFake();
  });

  it("books after decide opening and accept", async () => {
    const opening = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: {
        action: "negotiate",
        load_id: LOAD,
        carrier_counter: "",
        otp_challenge_status: "passed",
        current_load_id: "",
        offers_history: [],
      },
    });
    expect(opening.statusCode).toBe(200);
    const brokerOffer = opening.json().agent.broker_offer as number;

    const accept = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: {
        action: "accept",
        load_id: LOAD,
        carrier_counter: "",
        otp_challenge_status: "passed",
        current_load_id: LOAD,
        offers_history: [
          {
            load_id: LOAD,
            round: 0,
            carrier_counter: null,
            broker_offer: brokerOffer,
            decision: "OPENING",
          },
        ],
      },
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().agent.decision).toBe("ACCEPT");

    const book = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: AUTH },
      payload: {
        load_id: LOAD,
        mc_number: "136818",
        agreed_rate: brokerOffer,
        run_id: "neg-book-1",
        otp_challenge_status: "passed",
      },
    });
    expect(book.statusCode).toBe(200);
    expect(book.json()).toEqual({
      agent: { status: "BOOKED", booking_ref: `BR-${LOAD}` },
      calls: { booking_ref: `BR-${LOAD}`, outcome: "booked" },
    });
  });
});
