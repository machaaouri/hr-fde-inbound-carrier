/**
 * Trace STATUS through LOAD_GET / bridge decide / book for one OPEN load.
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TmsClient } from "../src/tms/client.ts";
import { encodeLoadBook, encodeLoadGet, encodeLoadQuery } from "../src/tms/commands.ts";
import { TMS_FIELD } from "../src/tms/fields.ts";
import { tmsTrim, tmsPaddedInt } from "../src/loads/tms-record.ts";
import type { DecideWorkflowResponse } from "../src/offers/decide-types.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: resolve(repoRoot, ".env") });

const bridgeBase =
  process.env.BRIDGE_TRACE_URL ??
  "https://inbound-carrier-bridge-530898712073.us-central1.run.app";
const bridgeKey = process.env.BRIDGE_API_KEY?.trim();

function statusOf(record: Map<string, string>): string {
  return tmsTrim(record.get(TMS_FIELD.STATUS) ?? "?");
}

async function loadGet(client: TmsClient, token: string, loadId: string, label: string) {
  const parsed = await client.executeRead(encodeLoadGet(token, loadId), `GET:${label}`);
  if (parsed.kind === "error") {
    console.log(`  ${label}: ERR ${parsed.wire.code}`);
    return null;
  }
  const rec = parsed.records[0];
  if (!rec) {
    console.log(`  ${label}: (no record)`);
    return null;
  }
  const st = statusOf(rec);
  const rate = rec.get(TMS_FIELD.RATE);
  const max = rec.get(TMS_FIELD.MAX_BUY);
  const ref = rec.get(TMS_FIELD.BOOKING_REF);
  console.log(
    `  ${label}: STATUS=${st} RATE=${rate?.trim()} MAX_BUY=${max?.trim() ?? "—"} REF=${ref?.trim() ?? "—"}`,
  );
  return rec;
}

async function main() {
  const token = process.env.TMS_TOKEN!.trim();
  const client = TmsClient.fromConfig({
    appEnv: "development",
    port: 8080,
    logLevel: "error",
    bridgeApiKey: "x",
    tmsHost: process.env.TMS_HOST!,
    tmsPort: Number(process.env.TMS_PORT),
    tmsToken: token,
    fmcsaApiKey: "x",
  });

  const q = await client.executeRead(
    encodeLoadQuery(token, { eqtype: "DRY_VAN", max_results: 20 }),
    "QUERY",
  );
  if (q.kind === "error") {
    console.error("QUERY failed", q.wire);
    process.exit(1);
  }
  const open = q.records.filter((r) => statusOf(r) === "OPEN");
  const loadId = process.argv[2]?.trim() ?? open[0]?.get(TMS_FIELD.LOAD_ID)?.trim();
  if (!loadId) {
    console.error("No OPEN load found");
    process.exit(1);
  }
  console.log(`\n=== Trace load ${loadId} (bridge ${bridgeBase}) ===\n`);

  await loadGet(client, token, loadId, "0 baseline LOAD_GET");

  if (!bridgeKey) {
    console.log("\n(no BRIDGE_API_KEY — skipping bridge steps)");
    process.exit(0);
  }

  const decide = async (
    body: Record<string, unknown>,
    step: string,
  ): Promise<DecideWorkflowResponse> => {
    const res = await fetch(`${bridgeBase}/v1/offers/decide`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bridgeKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as DecideWorkflowResponse;
    console.log(`\n  bridge decide ${step}:`, JSON.stringify(json.agent));
    await loadGet(client, token, loadId, `after decide ${step}`);
    return json;
  };

  const rec0 = await client.executeRead(encodeLoadGet(token, loadId), "G");
  const maxBuy =
    rec0.kind === "success" && rec0.records[0]
      ? tmsPaddedInt(rec0.records[0].get(TMS_FIELD.MAX_BUY) ?? "0", TMS_FIELD.MAX_BUY)
      : 2000;
  const posted =
    rec0.kind === "success" && rec0.records[0]
      ? tmsPaddedInt(rec0.records[0].get(TMS_FIELD.RATE) ?? "0", TMS_FIELD.RATE)
      : 1500;
  const counter = Math.min(maxBuy, posted + 100);

  let rounds = 0;
  let standing: number | null = null;
  let current = "";

  const openRes = await decide(
    {
      action: "negotiate",
      load_id: loadId,
      carrier_counter: "",
      otp_status: "passed",
      current_load_id: "",
      rounds_used: 0,
      standing_offer: null,
      agreed_rate: null,
      outcome: "agreed",
    },
    "opening",
  );
  standing = openRes.agent?.broker_offer ?? null;
  current = loadId;
  rounds = 1;

  const counterRes = await decide(
    {
      action: "negotiate",
      load_id: loadId,
      carrier_counter: String(counter),
      otp_status: "passed",
      current_load_id: current,
      rounds_used: rounds,
      standing_offer: standing,
      agreed_rate: null,
      outcome: "agreed",
    },
    `counter ${counter}`,
  );
  if (counterRes.agent?.decision === "ACCEPT") {
    standing = counterRes.agent.agreed_rate;
  } else if (counterRes.agent?.broker_offer != null) {
    standing = counterRes.agent.broker_offer;
    rounds += 1;
  }

  const agreed = standing ?? counter;
  await decide(
    {
      action: "accept",
      load_id: loadId,
      carrier_counter: "",
      otp_status: "passed",
      current_load_id: current,
      rounds_used: rounds,
      standing_offer: agreed,
      agreed_rate: null,
      outcome: "agreed",
    },
    "accept",
  );

  console.log(`\n  bridge book agreed_rate=${agreed}`);
  const bookRes = await fetch(`${bridgeBase}/v1/bookings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bridgeKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      load_id: loadId,
      mc_number: "136818",
      agreed_rate: agreed,
      run_id: "pending-trace",
      otp_status: "passed",
      outcome: "agreed",
    }),
  });
  console.log("  book response:", JSON.stringify(await bookRes.json()));

  await loadGet(client, token, loadId, "after book");

  console.log("\n  direct LOAD_BOOK retry (diagnostic)…");
  const bookWire = await client.executeWrite(
    encodeLoadBook(token, loadId, "136818", agreed),
    "LOAD_BOOK_DIRECT",
  );
  if (bookWire.kind === "error") {
    console.log(`  LOAD_BOOK: ERR ${bookWire.wire.code} ${bookWire.wire.message}`);
  } else {
    const r = bookWire.records[0];
    console.log(`  LOAD_BOOK: STATUS=${statusOf(r ?? new Map())} REF=${r?.get(TMS_FIELD.BOOKING_REF)?.trim()}`);
  }
  await loadGet(client, token, loadId, "after direct LOAD_BOOK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
