import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import { logRouteOutcome, setRouteOutcome } from "../src/http/route-log.ts";

describe("logRouteOutcome", () => {
  it("emits one route outcome line with request_id and hr_run_id", async () => {
    const lines: unknown[] = [];
    const app = Fastify({
      logger: {
        level: "info",
        stream: {
          write(chunk: string) {
            lines.push(JSON.parse(chunk));
          },
        },
      },
    });
    const req = {
      log: app.log,
      ctx: {
        requestId: "req-test-abc",
        hrRunId: "run-outcome-1",
        startedAtMs: performance.now(),
        tmsMs: 0,
      },
    } as FastifyRequest;
    setRouteOutcome(req, { endpoint: "health", status: "ok" });
    logRouteOutcome(req.log, req);
    await app.close();

    const outcome = lines.filter(
      (row) => (row as { msg?: string }).msg === "route outcome",
    );
    expect(outcome).toHaveLength(1);
    const payload = outcome[0] as {
      request_id: string;
      hr_run_id: string;
      endpoint: string;
    };
    expect(payload.hr_run_id).toBe("run-outcome-1");
    expect(payload.request_id).toBe("req-test-abc");
    expect(payload.endpoint).toBe("health");
    expect(JSON.stringify(payload)).not.toMatch(/max_rate|otp_code|code_hash|salt/i);
  });
});
