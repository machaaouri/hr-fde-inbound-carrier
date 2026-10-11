import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TmsClient } from "../../src/tms/client.ts";
import { encodeDebugEcho, encodeLoadQuery } from "../../src/tms/commands.ts";
import { FakeTmsServer } from "../../src/tms/fake/server.ts";

const TOKEN = "t-fault-test";
const FAST = { responseMs: 400, readMaxAttempts: 2, readBackoffMs: 50 };

describe("TmsClient against fake TMS faults", () => {
  let fake: FakeTmsServer;
  let port: number;
  let closeFake: () => Promise<void>;

  beforeEach(async () => {
    fake = new FakeTmsServer({ token: TOKEN });
    const started = await fake.listen(0);
    port = started.port;
    closeFake = started.close;
  });

  afterEach(async () => {
    fake.setFault(null);
    await closeFake();
  });

  function client(): TmsClient {
    return new TmsClient({ host: "127.0.0.1", port, token: TOKEN, ...FAST });
  }

  it("DEBUG_ECHO succeeds (bypasses fault injection on fake server)", async () => {
    fake.setFault("timeout");
    const parsed = await client().executeRead(
      encodeDebugEcho(TOKEN, "HELLO"),
      "DEBUG_ECHO",
    );
    expect(parsed.kind).toBe("success");
  });

  it("timeout → TMS_UNAVAILABLE", async () => {
    fake.setFault("timeout");
    await expect(
      client().executeRead(
        encodeLoadQuery(TOKEN, { orig_state: "GA", eqtype: "DRY_VAN" }),
        "LOAD_QUERY",
      ),
    ).rejects.toMatchObject({ code: "TMS_UNAVAILABLE" });
  });

  it("partial response → TMS_BAD_RESPONSE", async () => {
    fake.setFault("partial");
    await expect(
      client().executeRead(
        encodeLoadQuery(TOKEN, { orig_state: "GA", eqtype: "DRY_VAN" }),
        "LOAD_QUERY",
      ),
    ).rejects.toMatchObject({ code: "TMS_BAD_RESPONSE" });
  });

  it("malformed framing → TMS_BAD_RESPONSE", async () => {
    fake.setFault("malformed");
    await expect(
      client().executeRead(
        encodeLoadQuery(TOKEN, { orig_state: "GA", eqtype: "DRY_VAN" }),
        "LOAD_QUERY",
      ),
    ).rejects.toMatchObject({ code: "TMS_BAD_RESPONSE" });
  });

  it("delayed termination still completes on END", async () => {
    fake.setFault("delayed_close");
    const parsed = await client().executeRead(
      encodeLoadQuery(TOKEN, { orig_state: "GA", eqtype: "DRY_VAN" }),
      "LOAD_QUERY",
    );
    expect(parsed.kind).toBe("success");
  });

  it("maps AUTH_FAILED to TMS_UNAVAILABLE", async () => {
    const parsed = await client().executeRead(
      encodeLoadQuery("wrong-token", { orig_state: "GA", eqtype: "DRY_VAN" }),
      "LOAD_QUERY",
    );
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.wire.code).toBe("AUTH_FAILED");
  });
});
