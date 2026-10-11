/** One LOAD_BOOK on first OPEN load; print wire + GET. */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TmsClient } from "../src/tms/client.ts";
import { encodeLoadBook, encodeLoadGet, encodeLoadQuery } from "../src/tms/commands.ts";
import { TMS_FIELD } from "../src/tms/fields.ts";
import { tmsTrim, tmsPaddedInt } from "../src/loads/tms-record.ts";
import { submitLoadBookWire } from "../src/bookings/submit-load-book.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: resolve(repoRoot, ".env") });

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
    encodeLoadQuery(token, { eqtype: "DRY_VAN", max_results: 40 }),
    "Q",
  );
  if (q.kind === "error") throw q.wire;
  const open = q.records.find((r) => tmsTrim(r.get(TMS_FIELD.STATUS) ?? "") === "OPEN");
  const loadId = process.argv[2]?.trim() ?? open?.get(TMS_FIELD.LOAD_ID)?.trim();
  if (!loadId) throw new Error("no OPEN load");

  const get = await client.executeRead(encodeLoadGet(token, loadId), "G");
  const rec = get.kind === "success" ? get.records[0] : undefined;
  const rate = rec ? tmsPaddedInt(rec.get(TMS_FIELD.RATE) ?? "0", TMS_FIELD.RATE) : 2000;
  console.log("load", loadId, "OPEN rate", rate);

  const parsed = await client.executeWrite(
    encodeLoadBook(token, loadId, "136818", rate),
    "BOOK",
  );
  console.log("raw parsed kind", parsed.kind);
  if (parsed.kind === "error") {
    console.log("wire error", parsed.wire);
  } else {
    for (const r of parsed.records) {
      console.log("wire record", Object.fromEntries(r));
    }
  }

  try {
    const via = await submitLoadBookWire(client, token, loadId, "136818", rate);
    console.log("submitLoadBookWire", via);
  } catch (e) {
    console.log("submitLoadBookWire threw", e);
  }

  const after = await client.executeRead(encodeLoadGet(token, loadId), "G2");
  if (after.kind === "success" && after.records[0]) {
    const r = after.records[0];
    console.log(
      "GET after",
      tmsTrim(r.get(TMS_FIELD.STATUS) ?? ""),
      "ref",
      tmsTrim(r.get(TMS_FIELD.BOOKING_REF) ?? ""),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
