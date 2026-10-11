import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BridgeConfig } from "../src/config/types.ts";
import { FmcsaClient } from "../src/fmcsa/client.ts";
import { buildApp } from "../src/server/build-app.ts";

const AUTH = "Bearer test-bridge-key-12345678";

const testConfig: BridgeConfig = {
  appEnv: "development",
  port: 8080,
  logLevel: "error",
  bridgeApiKey: "test-bridge-key-12345678",
  tmsHost: "127.0.0.1",
  tmsPort: 1,
  tmsToken: "t",
  fmcsaApiKey: "test-fmcsa-key",
};

function mockFetch(handlers: Record<string, () => Response>): typeof fetch {
  return vi.fn(async (input: string | URL | { url: string }) => {
    const url = typeof input === "string" ? input : "url" in input ? input.url : String(input);
    for (const [prefix, fn] of Object.entries(handlers)) {
      if (url.includes(prefix)) {
        return fn();
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("POST /v1/carriers/verify", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const fetchImpl = mockFetch({
      "/carriers/docket-number/136818": () =>
        new Response(
          JSON.stringify({
            content: [
              {
                carrier: {
                  dotNumber: 54283,
                  legalName: "Twin Test Carrier",
                  allowedToOperate: "Y",
                  commonAuthorityStatus: "A",
                  contractAuthorityStatus: "N",
                  oosDate: null,
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      "/carriers/54283/authority": () =>
        new Response(
          JSON.stringify({
            content: [
              {
                carrierAuthority: {
                  commonAuthorityStatus: "A",
                  contractAuthorityStatus: "A",
                  brokerAuthorityStatus: "A",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      "/carriers/docket-number/784219": () =>
        new Response(
          JSON.stringify({
            content: [
              {
                carrier: {
                  dotNumber: 2296639,
                  legalName: "BOZHA COMPANY INC",
                  allowedToOperate: "Y",
                  commonAuthorityStatus: "I",
                  contractAuthorityStatus: "N",
                  oosDate: null,
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      "/carriers/2296639/authority": () =>
        new Response(JSON.stringify({ content: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      "/carriers/docket-number/999999": () =>
        new Response(JSON.stringify({ content: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    const fmcsa = new FmcsaClient({
      webKey: "test-fmcsa-key",
      fetchImpl,
      responseMs: 5000,
    });
    app = await buildApp(testConfig, { fmcsa });
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns ACTIVE for eligible MC", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/carriers/verify",
      headers: { authorization: AUTH },
      payload: { mc_number: "MC136818" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      eligible: true,
      reason: "ACTIVE",
      carrier_name: "Twin Test Carrier",
      dot_number: "54283",
    });
    expect(JSON.stringify(res.json())).not.toMatch(/FMCSA|webKey|test-fmcsa/i);
  });

  it("returns NOT_AUTHORIZED for inactive MC 784219 shape", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/carriers/verify",
      headers: { authorization: AUTH },
      payload: { mc_number: "784219" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      eligible: false,
      reason: "NOT_AUTHORIZED",
      carrier_name: "BOZHA COMPANY INC",
      dot_number: "2296639",
    });
  });

  it("returns NOT_FOUND when FMCSA has no carrier", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/carriers/verify",
      headers: { authorization: AUTH },
      payload: { mc_number: "999999" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ eligible: false, reason: "NOT_FOUND" });
  });

  it("422 on invalid mc_number", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/carriers/verify",
      headers: { authorization: AUTH },
      payload: { mc_number: "not-a-number" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("503 when FMCSA errors", async () => {
    const failFetch = vi.fn(async () => new Response("error", { status: 500 })) as typeof fetch;
    const fmcsa = new FmcsaClient({ webKey: "k", fetchImpl: failFetch });
    const failApp = await buildApp(testConfig, { fmcsa });
    const res = await failApp.inject({
      method: "POST",
      url: "/v1/carriers/verify",
      headers: { authorization: AUTH },
      payload: { mc_number: "784219" },
    });
    await failApp.close();
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("FMCSA_UNAVAILABLE");
    expect(res.json().error.retryable).toBe(true);
  });

  it("503 FMCSA_MISCONFIGURED when webKey not found", async () => {
    const badKeyFetch = mockFetch({
      "/carriers/docket-number/784219": () =>
        new Response(
          JSON.stringify({ content: "Webkey not found", retrievalDate: "2026-01-01T00:00:00.000+0000" }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
    });
    const fmcsa = new FmcsaClient({ webKey: "bad", fetchImpl: badKeyFetch });
    const misApp = await buildApp(testConfig, { fmcsa });
    const res = await misApp.inject({
      method: "POST",
      url: "/v1/carriers/verify",
      headers: { authorization: AUTH },
      payload: { mc_number: "784219" },
    });
    await misApp.close();
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("FMCSA_MISCONFIGURED");
    expect(res.json().error.retryable).toBe(false);
  });
});
