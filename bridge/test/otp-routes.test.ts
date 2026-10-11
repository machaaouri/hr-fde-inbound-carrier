import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BridgeConfig } from "../src/config/types.ts";
import { buildApp } from "../src/server/build-app.ts";
import { hashOtpCode } from "../src/otp/crypto.ts";
import { sendOtp } from "../src/otp/service.ts";

const testConfig: BridgeConfig = {
  appEnv: "development",
  port: 8080,
  logLevel: "error",
  bridgeApiKey: "test-bridge-key-12345678",
  tmsHost: "127.0.0.1",
  tmsPort: 1,
  tmsToken: "t-test",
  fmcsaApiKey: "fmcsa-test",
};

describe("OTP HTTP routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(testConfig);
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = { authorization: "Bearer test-bridge-key-12345678" };

  it("POST /v1/otp/send returns real code and hash", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/otp/send",
      headers: auth,
      payload: {
        run_id: "run-1",
        mc_number: "MC-1",
        email: "carrier@example.com",
        resends: 0,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      otp_code: string;
      code_hash: string;
      salt: string;
    };
    expect(body.otp_code).toMatch(/^\d{6}$/);
    expect(body.code_hash).toBe(hashOtpCode(body.salt, body.otp_code));
  });

  it("POST /v1/otp/send rejects resend limit", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/otp/send",
      headers: auth,
      payload: {
        run_id: "run-1",
        mc_number: "MC-1",
        email: "carrier@example.com",
        resends: 2,
        is_resend: true,
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("POST /v1/otp/verify passes with matching code", async () => {
    const sent = sendOtp({
      run_id: "run-1",
      mc_number: "MC-1",
      email: "a@b.com",
      resends: 0,
    });
    if ("code" in sent) throw new Error("send failed");

    const res = await app.inject({
      method: "POST",
      url: "/v1/otp/verify",
      headers: auth,
      payload: {
        run_id: "run-1",
        code: sent.otp_code,
        code_hash: sent.code_hash,
        salt: sent.salt,
        expires_at: sent.expires_at,
        attempts: 0,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toBe("passed");
  });
});
