import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { searchLoads } from "../src/loads/search-service.ts";
import { TmsClient } from "../src/tms/client.ts";
import { FakeTmsServer } from "../src/tms/fake/server.ts";

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
