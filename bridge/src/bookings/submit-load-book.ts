import { BridgeError } from "../http/errors.ts";
import type { TmsClient } from "../tms/client.ts";
import { encodeLoadBook } from "../tms/commands.ts";
import { TMS_FIELD, TMS_LOAD_STATUS } from "../tms/fields.ts";
import { bridgeErrorFromTmsWire } from "../tms/map-wire-error.ts";
import { tmsTrim } from "../loads/tms-record.ts";

export type LoadBookWireResult =
  | { kind: "booked"; booking_ref: string }
  | { kind: "already_booked" }
  | { kind: "wire_error"; code: string; message: string };

export async function submitLoadBookWire(
  client: TmsClient,
  tmsToken: string,
  loadId: string,
  mcDigits: string,
  agreedRate: number,
): Promise<LoadBookWireResult> {
  const parsed = await client.executeWrite(
    encodeLoadBook(tmsToken, loadId, mcDigits, agreedRate),
    "LOAD_BOOK",
  );

  if (parsed.kind === "error") {
    if (parsed.wire.code === "ALREADY_BOOKED") {
      return { kind: "already_booked" };
    }
    throw bridgeErrorFromTmsWire(parsed.wire.code, parsed.wire.message);
  }

  const record = parsed.records[0];
  if (!record) {
    throw new BridgeError("TMS_BAD_RESPONSE", "LOAD_BOOK returned no record", 502, true);
  }

  const status = tmsTrim(record.get(TMS_FIELD.STATUS) ?? "");
  const ref = tmsTrim(record.get(TMS_FIELD.BOOKING_REF) ?? "");
  if (ref === "") {
    throw new BridgeError("TMS_BAD_RESPONSE", "LOAD_BOOK missing BOOKING_REF", 502, true);
  }
  // Handbook success is STATUS:BOOKED; live TMS often returns PENDING with a booking ref (token hold).
  if (status !== TMS_LOAD_STATUS.BOOKED && status !== TMS_LOAD_STATUS.PENDING) {
    throw new BridgeError(
      "TMS_BAD_RESPONSE",
      `LOAD_BOOK unexpected STATUS:${status}`,
      502,
      true,
    );
  }

  return { kind: "booked", booking_ref: ref };
}
