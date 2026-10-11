import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BridgeConfig } from "../src/config/types.ts";
import { decideOfferForWorkflow } from "../src/offers/decide-service.ts";
import { TmsClient } from "../src/tms/client.ts";
import { FakeTmsServer } from "../src/tms/fake/server.ts";

const TOKEN = "t-decide-test";

const config: BridgeConfig = {
  appEnv: "development",
  port: 8080,
  logLevel: "error",
  bridgeApiKey: "test-key",
  tmsHost: "127.0.0.1",
  tmsPort: 1,
  tmsToken: TOKEN,
  fmcsaApiKey: "x",
};

describe("decideOfferForWorkflow (fake TMS)", () => {
  let fake: FakeTmsServer;
  let client: TmsClient;
  let closeFake: () => Promise<void>;

  beforeEach(async () => {
    fake = new FakeTmsServer({ token: TOKEN });
    const started = await fake.listen(0);
    closeFake = started.close;
    client = new TmsClient({
      host: "127.0.0.1",
      port: started.port,
      token: TOKEN,
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
      config,
      {
        action: "negotiate",
        load_id: "LD0000045821",
        carrier_counter: "",
        otp_status: "passed",
        current_load_id: "",
        rounds_used: 0,
        standing_offer: null,
        agreed_rate: null,
        outcome: "abandoned",
      },
      {
        warn: (_fields, message) => warnings.push(message),
      },
    );
    expect(warnings.some((m) => m.includes("loadboard_rate exceeds max_rate"))).toBe(
      true,
    );
  });

  it("returns OPENING at clamped loadboard for handbook load", async () => {
    const out = await decideOfferForWorkflow(client, config, {
      action: "negotiate",
      load_id: "LD0000045821",
      carrier_counter: "",
      otp_status: "passed",
      current_load_id: "",
      rounds_used: 0,
      standing_offer: null,
      agreed_rate: null,
      outcome: "abandoned",
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
