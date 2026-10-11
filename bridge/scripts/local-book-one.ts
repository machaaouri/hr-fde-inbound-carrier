import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TmsClient } from "../src/tms/client.ts";
import { encodeLoadQuery } from "../src/tms/commands.ts";
import { TMS_FIELD } from "../src/tms/fields.ts";
import { tmsTrim, tmsPaddedInt } from "../src/loads/tms-record.ts";
import { executeBookingOnTms } from "../src/bookings/create-booking-service.ts";

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
    encodeLoadQuery(token, { eqtype: "DRY_VAN", max_results: 30 }),
    "Q",
  );
  if (q.kind === "error") throw q.wire;
  const open = q.records.find((r) => tmsTrim(r.get(TMS_FIELD.STATUS) ?? "") === "OPEN");
  const loadId = open?.get(TMS_FIELD.LOAD_ID)?.trim();
  if (!loadId) throw new Error("no OPEN");
  const rate = tmsPaddedInt(open!.get(TMS_FIELD.RATE) ?? "0", TMS_FIELD.RATE);
  const result = await executeBookingOnTms(client, token, loadId, "136818", rate);
  console.log(loadId, rate, result);
}

main();
