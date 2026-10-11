import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BridgeConfig } from "../src/config/types.ts";
import { isBookableLoad } from "../src/loads/tms-record.ts";
import { parseRecordLine } from "../src/tms/parser.ts";
import { searchLoads } from "../src/loads/search-service.ts";
import { buildApp } from "../src/server/build-app.ts";
import { TmsClient } from "../src/tms/client.ts";
import { FakeTmsServer } from "../src/tms/fake/server.ts";

const TOKEN = "t-bookable";
const PENDING_LOAD = "LD000009923";
const OPEN_AL_MO = "LD000009924";

describe("isBookableLoad", () => {
  it("OPEN is bookable; PENDING and BOOKED are not", () => {
    expect(isBookableLoad(parseRecordLine("LOAD_ID:X|STATUS:OPEN"))).toBe(true);
    expect(isBookableLoad(parseRecordLine("LOAD_ID:X|STATUS:PENDING"))).toBe(false);
    expect(isBookableLoad(parseRecordLine("LOAD_ID:X|STATUS:BOOKED"))).toBe(false);
  });
});

describe("PENDING load LD000009923 across search / decide / book", () => {
  let app: FastifyInstance;
  let client: TmsClient;
  let closeFake: () => Promise<void>;

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

  const AUTH = "Bearer test-bridge-key-12345678";

  beforeAll(async () => {
    const fake = new FakeTmsServer({ token: TOKEN });
    const started = await fake.listen(0);
    closeFake = started.close;
    testConfig.tmsPort = started.port;
    client = new TmsClient({
      host: "127.0.0.1",
      port: started.port,
      token: TOKEN,
      responseMs: 800,
    });
    app = await buildApp(testConfig, { tms: client });
  });

  afterAll(async () => {
    await app.close();
    await closeFake();
  });

  it("search excludes PENDING but includes OPEN on same lane", async () => {
    const out = await searchLoads(client, TOKEN, {
      equipment_type: "DRY_VAN",
      origin_state: "AL",
      dest_state: "MO",
    });
    const ids = out.loads.map((l) => l.id);
    expect(ids).toContain(OPEN_AL_MO);
    expect(ids).not.toContain(PENDING_LOAD);
  });

  it("decide returns LOAD_UNAVAILABLE before negotiation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/offers/decide",
      headers: { authorization: AUTH },
      payload: {
        action: "negotiate",
        load_id: PENDING_LOAD,
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
    expect(res.json().agent.decision).toBe("LOAD_UNAVAILABLE");
  });

  it("bookings returns LOAD_UNAVAILABLE", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/bookings",
      headers: { authorization: AUTH },
      payload: {
        load_id: PENDING_LOAD,
        mc_number: "136818",
        agreed_rate: 750,
        run_id: "run-pending",
        otp_status: "passed",
        outcome: "agreed",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().agent.status).toBe("LOAD_UNAVAILABLE");
  });
});
