/**
 * List OPEN loads from live TMS (dev probe). Not the production API — /v1/loads/search caps at 3.
 *
 *   make list-loads
 *   make list-loads LIMIT=10 EQUIPMENT=REEFER
 */
import { loadConfig } from "../bridge/src/config/config.ts";
import {
  isBookableLoad,
  isFuturePickup,
  mapTmsSearchRowToSafeLoad,
} from "../bridge/src/loads/mapping.ts";
import { TmsClient, unwrapTmsResponse } from "../bridge/src/tms/client.ts";
import { encodeLoadQuery } from "../bridge/src/tms/protocol.ts";

const limit = Math.min(
  50,
  Math.max(1, Number.parseInt(process.env.LIMIT ?? "10", 10) || 10),
);
const equipment = (process.env.EQUIPMENT ?? "DRY_VAN").trim().toUpperCase();
const tmsMs = Number.parseInt(process.env.SEARCH_LOADS_TMS_MS ?? "8000", 10);

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new TmsClient({
    host: config.tmsHost,
    port: config.tmsPort,
    token: config.tmsToken,
    responseMs: tmsMs,
  });

  const queryLine = encodeLoadQuery(config.tmsToken, {
    eqtype: equipment,
    max_results: 50,
  });
  console.log(`LOAD_QUERY eqtype=${equipment} (showing up to ${limit} OPEN, future pickup)\n`);

  const parsed = await client.executeRead(queryLine, "LOAD_QUERY");
  const rows = unwrapTmsResponse(parsed);

  let shown = 0;
  for (const record of rows) {
    if (shown >= limit) break;
    if (!isBookableLoad(record) || !isFuturePickup(record)) continue;
    try {
      const load = mapTmsSearchRowToSafeLoad(record);
      shown++;
      const lane = `${load.origin.city}, ${load.origin.state} → ${load.destination.city}, ${load.destination.state}`;
      console.log(
        `${String(shown).padStart(2)}. ${load.id}  ${load.equipment_type.padEnd(10)}  $${load.loadboard_rate}  ${lane}`,
      );
    } catch {
      continue;
    }
  }

  if (shown === 0) {
    console.log("No OPEN loads matched (try EQUIPMENT=REEFER or FLATBED).");
  } else {
    console.log(`\nUse load id with negotiate/book (e.g. LD00983).`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
