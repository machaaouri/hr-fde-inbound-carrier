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
import { BridgeError } from "../src/http/errors.ts";
import {
  mapTmsRecordToSafeLoad,
  mapTmsSearchRowToSafeLoad,
} from "../src/loads/map-safe-load.ts";
import { normalizeSearchLoadsInput } from "../src/loads/normalize-search-input.ts";
import { searchLoads } from "../src/loads/search-service.ts";
import { isBookableLoad } from "../src/loads/tms-record.ts";
import { toLoadQueryFilters } from "../src/loads/to-tms-filters.ts";
import { buildApp } from "../src/server/build-app.ts";
import { encodeLoadQuery } from "../src/tms/commands.ts";
import { TmsClient } from "../src/tms/client.ts";
import { TMS_FIELD } from "../src/tms/fields.ts";
import { parseRecordLine } from "../src/tms/parser.ts";
import { FakeTmsServer } from "./fake-tms/server.ts";

const TOKEN = "t-search-test";

describe("searchLoads", () => {
  let fake: FakeTmsServer;
  let port: number;
  let closeFake: () => Promise<void>;
  let client: TmsClient;

  beforeEach(async () => {
    fake = new FakeTmsServer({ token: TOKEN });
    const started = await fake.listen(0);
    port = started.port;
    closeFake = started.close;
    client = new TmsClient({
      host: "127.0.0.1",
      port,
      token: TOKEN,
      responseMs: 800,
    });
  });

  afterEach(async () => {
    await closeFake();
  });

  it("returns up to 3 safe loads without rate fields", async () => {
    const out = await searchLoads(client, TOKEN, {
      equipment_type: "DRY_VAN",
      origin_state: "GA",
      dest_state: "TX",
    });
    expect(out.loads.length).toBeGreaterThan(0);
    expect(out.loads.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(out)).not.toMatch(/max_buy|MAX_BUY|ceiling/i);
    expect(out.loads[0]?.loadboard_rate).toBeGreaterThan(0);
    for (const load of out.loads) {
      expect(load.id).toMatch(/^LD/);
      expect(load.origin.state).toBe("GA");
    }
  });

  it("filters past pickup and non-OPEN statuses", async () => {
    const out = await searchLoads(client, TOKEN, {
      equipment_type: "DRY_VAN",
      origin_state: "AL",
      dest_state: "MO",
    });
    expect(out.loads.map((l) => l.id)).toEqual(["LD000009924"]);
  });

  it("returns empty list when QUERY matches nothing", async () => {
    const out = await searchLoads(client, TOKEN, {
      equipment_type: "DRY_VAN",
      origin_city: "Boise",
      dest_state: "VT",
    });
    expect(out.loads).toEqual([]);
  });
});


const AUTH = "t-test";

function expectValidation(fn: () => void): void {
  try {
    fn();
    throw new Error("expected validation error");
  } catch (err) {
    expect(err).toBeInstanceOf(BridgeError);
    expect((err as BridgeError).code).toBe("VALIDATION_ERROR");
    expect((err as BridgeError).statusCode).toBe(422);
  }
}

describe("normalizeSearchLoadsInput", () => {
  it.each([
    ["origin_state", { equipment_type: "DRY_VAN", origin_state: "" }],
    ["dest_state", { equipment_type: "DRY_VAN", dest_state: "   " }],
    ["origin_city", { equipment_type: "DRY_VAN", origin_city: "" }],
    ["pickup_date", { equipment_type: "DRY_VAN", pickup_date: "" }],
  ] as const)("treats empty %s as not provided", (_field, body) => {
    const out = normalizeSearchLoadsInput(body);
    expect(out.equipment_type).toBe("DRY_VAN");
    if ("origin_state" in body) expect(out.origin_state).toBeUndefined();
    if ("dest_state" in body) expect(out.dest_state).toBeUndefined();
    if ("origin_city" in body) expect(out.origin_city).toBeUndefined();
    if ("pickup_date" in body) expect(out.pickup_date).toBeUndefined();
  });

  it("allows only origin_state", () => {
    const out = normalizeSearchLoadsInput({
      equipment_type: "REEFER",
      origin_state: "AL",
    });
    expect(out.origin_state).toBe("AL");
    expect(out.dest_state).toBeUndefined();
  });

  it("allows only dest_state", () => {
    const out = normalizeSearchLoadsInput({
      equipment_type: "REEFER",
      dest_state: "MO",
    });
    expect(out.dest_state).toBe("MO");
    expect(out.origin_state).toBeUndefined();
  });

  it("allows only equipment_type", () => {
    const out = normalizeSearchLoadsInput({
      equipment_type: "FLATBED",
    });
    expect(out.equipment_type).toBe("FLATBED");
    expect(out.origin_state).toBeUndefined();
    expect(out.dest_state).toBeUndefined();
    expect(out.origin_city).toBeUndefined();
  });

  it("uppercases lowercase state and equipment", () => {
    const out = normalizeSearchLoadsInput({
      equipment_type: "dry_van",
      origin_state: "ga",
      dest_state: "tx",
    });
    expect(out.equipment_type).toBe("DRY_VAN");
    expect(out.origin_state).toBe("GA");
    expect(out.dest_state).toBe("TX");
  });

  it("rejects invalid state names with VALIDATION_ERROR", () => {
    expectValidation(() =>
      normalizeSearchLoadsInput({
        equipment_type: "DRY_VAN",
        origin_state: "Georgia",
      }),
    );
  });

  it("trims city but does not uppercase", () => {
    const out = normalizeSearchLoadsInput({
      equipment_type: "DRY_VAN",
      origin_city: "  Miami  ",
    });
    expect(out.origin_city).toBe("Miami");
  });
});

describe("TMS LOAD_QUERY line from search input", () => {
  it("contains no empty field segments", () => {
    const normalized = normalizeSearchLoadsInput({
      equipment_type: "dry_van",
      origin_state: "",
      dest_state: "mo",
      origin_city: "",
    });
    const line = encodeLoadQuery(AUTH, toLoadQueryFilters(normalized));
    const body = line.replace(/\r\n$/, "");
    expect(body).not.toMatch(/\|[A-Z_]+:\|/);
    expect(body).not.toMatch(/\|[A-Z_]+:\s*\|/);
    expect(body).toBe(
      "CMD:LOAD_QUERY|AUTH:t-test|DEST_STATE:MO|EQTYPE:DRY_VAN",
    );
  });

  it("equipment-only query is valid for handbook", () => {
    const line = encodeLoadQuery(
      AUTH,
      toLoadQueryFilters(
        normalizeSearchLoadsInput({ equipment_type: "REEFER" }),
      ),
    );
    expect(line.replace(/\r\n$/, "")).toBe(
      "CMD:LOAD_QUERY|AUTH:t-test|EQTYPE:REEFER",
    );
  });
});


describe("mapTmsRecordToSafeLoad", () => {
  it("allows missing NOTES and DIMS on live TMS rows", () => {
    const line =
      "LOAD_ID:LD1|ORIG_CITY:Birmingham|ORIG_STATE:AL|ORIG_ZIP:35203|DEST_CITY:Kansas City|DEST_STATE:MO|DEST_ZIP:64106|PICKUP_DT:20270312080000|DELIVERY_DT:20270313170000|EQTYPE:DRY_VAN|RATE:0001800|WEIGHT:0042000|COMMODITY:GENERAL FREIGHT|PIECES:000026|MILES:000612|STATUS:OPEN";
    expect(mapTmsRecordToSafeLoad(parseRecordLine(line)).loadboard_rate).toBe(1800);
    const record = parseRecordLine(line);
    const safe = mapTmsRecordToSafeLoad(record);
    expect(safe.notes).toBe("");
    expect(safe.dimensions).toBe("");
    expect(safe.id).toBe("LD1");
    expect(record.has(TMS_FIELD.NOTES)).toBe(false);
  });

  it("maps LOAD_QUERY summary rows without DELIVERY_DT or cargo fields", () => {
    const line =
      "LOAD_ID:LD0000045821|ORIG_CITY:Atlanta|ORIG_STATE:GA|ORIG_ZIP:30303|DEST_CITY:Dallas|DEST_STATE:TX|DEST_ZIP:75201|PICKUP_DT:20270312080000|EQTYPE:DRY_VAN|RATE:0002150|MILES:000785|STATUS:OPEN";
    const safe = mapTmsSearchRowToSafeLoad(parseRecordLine(line));
    expect(safe.id).toBe("LD0000045821");
    expect(safe.loadboard_rate).toBe(2150);
    expect(safe.delivery_at).toBe("");
    expect(safe.weight).toBe(0);
    expect(safe.commodity).toBe("");
  });
});


const BOOKABLE_TOKEN = "t-bookable";
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
    tmsToken: BOOKABLE_TOKEN,
    fmcsaApiKey: "x",
  };

  const AUTH = "Bearer test-bridge-key-12345678";

  beforeAll(async () => {
    const fake = new FakeTmsServer({ token: BOOKABLE_TOKEN });
    const started = await fake.listen(0);
    closeFake = started.close;
    testConfig.tmsPort = started.port;
    client = new TmsClient({
      host: "127.0.0.1",
      port: started.port,
      token: BOOKABLE_TOKEN,
      responseMs: 800,
    });
    app = await buildApp(testConfig, { tms: client });
  });

  afterAll(async () => {
    await app.close();
    await closeFake();
  });

  it("search excludes PENDING but includes OPEN on same lane", async () => {
    const out = await searchLoads(client, BOOKABLE_TOKEN, {
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
        otp_challenge_status: "passed",
        current_load_id: "",
        offers_history: [],
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
        otp_challenge_status: "passed",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().agent.status).toBe("LOAD_UNAVAILABLE");
  });
});
