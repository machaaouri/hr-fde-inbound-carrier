/**
 * Step-1 TMS probe: DEBUG_ECHO, broad LOAD_QUERY inventory, LOAD_GET for MAX_BUY.
 * Loads credentials from repo-root `.env` without printing secrets.
 */
import { createConnection, type Socket } from "node:net";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import {
  debugEchoMatchesRequest,
  encodeDebugEcho,
  encodeLoadGet,
  encodeLoadQuery,
} from "../src/tms/index.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: resolve(repoRoot, ".env") });

const host = process.env.TMS_HOST;
const port = Number(process.env.TMS_PORT);
const token = process.env.TMS_TOKEN?.trim();

const CONNECT_MS = 3_000;
const RESPONSE_MS = 12_000;
const READ_ATTEMPTS = 2;
const READ_BACKOFF_MS = 200;

function requireEnv(): void {
  const missing: string[] = [];
  if (!host) missing.push("TMS_HOST");
  if (!Number.isFinite(port)) missing.push("TMS_PORT");
  if (!token) missing.push("TMS_TOKEN");
  if (missing.length) {
    console.error(
      `Missing ${missing.join(", ")}. Copy .env.example to .env and fill TMS values.`,
    );
    process.exit(1);
  }
}

function parseRecord(line: string): Map<string, string> {
  const trimmed = line.replace(/\r?\n$/, "");
  if (trimmed === "END" || trimmed.startsWith("ERR|")) {
    return new Map();
  }
  const map = new Map<string, string>();
  for (const segment of trimmed.split("|")) {
    const idx = segment.indexOf(":");
    if (idx === -1) continue;
    const key = segment.slice(0, idx);
    const value = segment.slice(idx + 1).trimEnd();
    map.set(key, value);
  }
  return map;
}

function logStep(message: string): void {
  console.error(`[tms-probe] ${message}`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function tmsRequestOnce(
  line: string,
  phase: string,
): Promise<string[]> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const lines: string[] = [];
    let buffer = "";

    const finish = (ok: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(responseTimer);
      socket.destroy();
      ok();
    };

    const connectTimer = setTimeout(() => {
      finish(() => {
        reject(
          new Error(
            `${phase}: connect timed out after ${CONNECT_MS}ms (${host}:${port}). Check VPN/firewall and TMS_HOST/TMS_PORT.`,
          ),
        );
      });
    }, CONNECT_MS);

    const responseTimer = setTimeout(() => {
      finish(() => {
        reject(
          new Error(
            `${phase}: no complete response after ${RESPONSE_MS}ms. The TMS often injects timeouts on LOAD_QUERY/LOAD_GET — retrying may succeed.`,
          ),
        );
      });
    }, RESPONSE_MS);

    const socket: Socket = createConnection({ host: host!, port: port! }, () => {
      clearTimeout(connectTimer);
      socket.write(line);
    });

    socket.setEncoding("ascii");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\r\n")) !== -1) {
        const one = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        lines.push(one);
        if (one === "END" || one.startsWith("ERR|")) {
          finish(() => resolvePromise(lines));
          return;
        }
      }
    });
    socket.on("error", (err) => {
      finish(() => {
        reject(new Error(`${phase}: ${err.message}`));
      });
    });
    socket.on("close", () => {
      if (settled) return;
      if (lines.some((l) => l === "END" || l.startsWith("ERR|"))) {
        finish(() => resolvePromise(lines));
        return;
      }
      finish(() => {
        if (lines.length === 0 && buffer.length === 0) {
          reject(
            new Error(
              `${phase}: connection closed with no data (auth or network issue).`,
            ),
          );
          return;
        }
        reject(
          new Error(
            `${phase}: connection closed before END (partial response or delayed-termination fault).`,
          ),
        );
      });
    });
  });
}

async function tmsRequest(
  line: string,
  phase: string,
  retries = 1,
): Promise<string[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        logStep(`${phase}: retry ${attempt}/${retries}`);
        await sleep(READ_BACKOFF_MS);
      }
      return await tmsRequestOnce(line, phase);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function main(): Promise<void> {
  requireEnv();
  logStep(`Target ${host}:${port} (token loaded)`);

  const echoMsg = "probe";
  logStep("DEBUG_ECHO…");
  const echoResp = await tmsRequest(
    encodeDebugEcho(token!, echoMsg),
    "DEBUG_ECHO",
    1,
  );
  const echoLineRec = echoResp.find((l) => l.startsWith("ECHO|"));
  const echoOk =
    echoLineRec !== undefined &&
    debugEchoMatchesRequest(echoLineRec, echoMsg) &&
    echoResp.includes("END");
  if (!echoOk) {
    console.error("[tms-probe] DEBUG_ECHO failed:", echoResp.join(" | "));
    process.exit(1);
  }

  const eqCandidates = ["DRY_VAN", "REEFER", "FLATBED"];
  const records: string[] = [];
  const queryErrors: string[] = [];

  for (const eq of eqCandidates) {
    logStep(`LOAD_QUERY EQTYPE=${eq}…`);
    try {
      const queryResp = await tmsRequest(
        encodeLoadQuery(token!, { eqtype: eq, max_results: 50 }),
        `LOAD_QUERY(${eq})`,
        READ_ATTEMPTS,
      );
      const err = queryResp.find((l) => l.startsWith("ERR|"));
      if (err) {
        queryErrors.push(err);
        continue;
      }
      records.push(...queryResp.filter((l) => l.startsWith("LOAD_ID:")));
    } catch (err) {
      console.error(
        err instanceof Error ? err.message : String(err),
      );
      process.exit(1);
    }
  }

  if (records.length === 0 && queryErrors.length > 0) {
    console.log(
      JSON.stringify({ echo_ok: echoOk, query_errors: queryErrors }, null, 2),
    );
    process.exit(1);
  }

  const lanes = new Set<string>();
  const equipment = new Set<string>();
  const loadIds: string[] = [];

  for (const line of records) {
    const map = parseRecord(line);
    const id = map.get("LOAD_ID");
    if (id) loadIds.push(id.trim());
    const oSt = map.get("ORIG_STATE")?.trim();
    const dSt = map.get("DEST_STATE")?.trim();
    const eq = map.get("EQTYPE")?.trim();
    if (oSt && dSt) lanes.add(`${oSt}->${dSt}`);
    if (eq) equipment.add(eq);
  }

  const sampleLoadId = loadIds[0];
  let maxBuyPresent: boolean | null = null;
  let sampleRate: string | null = null;
  let sampleStatus: string | null = null;
  let maxBuyRate: string | null = null;

  if (sampleLoadId) {
    logStep(`LOAD_GET ${sampleLoadId}…`);
    const getResp = await tmsRequest(
      encodeLoadGet(token!, sampleLoadId),
      "LOAD_GET",
      READ_ATTEMPTS,
    );
    const getLineRec = getResp.find((l) => l.startsWith("LOAD_ID:"));
    if (getLineRec) {
      const map = parseRecord(getLineRec);
      maxBuyPresent = map.has("MAX_BUY");
      maxBuyRate = map.get("MAX_BUY")?.trim() ?? null;
      sampleRate = map.get("RATE")?.trim() ?? null;
      sampleStatus = map.get("STATUS")?.trim() ?? null;
    }
  }

  const laneList = [...lanes].sort();
  const eqList = [...equipment].sort();

  const matchingLane =
    laneList.find((l) => l === "GA->TX") ??
    laneList.find((l) => l.includes("GA") && l.includes("TX")) ??
    laneList[0] ??
    null;

  const noMatchHint =
    "Boise ORIG_CITY + DEST_STATE:VT + EQTYPE:REEFER returns empty per handbook";

  console.log(
    JSON.stringify(
      {
        echo_ok: echoOk,
        open_loads_sampled: records.length,
        equipment_types: eqList,
        lane_pairs: laneList,
        suggested_matching_lane: matchingLane,
        suggested_no_match: noMatchHint,
        sample_load_get: sampleLoadId
          ? {
              load_id: sampleLoadId,
              status: sampleStatus,
              posted_rate_field: sampleRate,
              max_buy_field_present: maxBuyPresent,
              max_buy_rate: maxBuyRate,
            }
          : null,
        note:
          maxBuyPresent === true
            ? "Token receives MAX_BUY on LOAD_GET — ceiling enforcement can proceed."
            : maxBuyPresent === false
              ? "MAX_BUY absent on LOAD_GET — bridge must fail closed with CEILING_UNAVAILABLE."
              : "No loads returned; re-run probe or widen query filters.",
      },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
