import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BridgeConfig } from "../src/config/types.ts";
import { buildApp } from "../src/server/build-app.ts";
import { TmsClient } from "../src/tms/client.ts";
import { FakeTmsServer } from "../src/tms/fake/server.ts";

const TOKEN = "t-neg-book";
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

describe("negotiate → accept → book (PENDING LOAD_BOOK wire)", () => {
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
