import { BridgeError } from "../http/errors.ts";
import type { TmsClient } from "./client.ts";
import { encodeLoadGet } from "./commands.ts";
import { bridgeErrorFromTmsWire } from "./map-wire-error.ts";

/** LOAD_GET → record map; typed BridgeError on wire/transport failure. */
export async function fetchLoadRecord(
  client: TmsClient,
  tmsToken: string,
  loadId: string,
  label = "LOAD_GET",
): Promise<Map<string, string>> {
  const parsed = await client.executeRead(
    encodeLoadGet(tmsToken, loadId),
    label,
  );
  if (parsed.kind === "error") {
    throw bridgeErrorFromTmsWire(parsed.wire.code, parsed.wire.message);
  }
  const record = parsed.records[0];
  if (!record) {
    throw new BridgeError("LOAD_NOT_FOUND", "Load not found", 404);
  }
  return record;
}
