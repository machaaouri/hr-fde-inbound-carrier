import { BridgeError } from "../http/errors.ts";
import { isBookableLoad } from "../loads/tms-record.ts";
import { tmsPaddedInt } from "../loads/tms-record.ts";
import type { TmsClient } from "../tms/client.ts";
import { fetchLoadRecord } from "../tms/fetch-load-record.ts";
import { TMS_FIELD } from "../tms/fields.ts";
import type { LoadPricing } from "../negotiation/types.ts";

export type LoadPricingSnapshot = LoadPricing & {
  loadAvailable: boolean;
};

/** Parse RATE/MAX_BUY when the record is already loaded. Non-bookable → no pricing fields read. */
export function parseLoadPricingFromRecord(record: Map<string, string>): LoadPricingSnapshot {
  if (!isBookableLoad(record)) {
    return { postedRate: 0, maxBuy: 0, loadAvailable: false };
  }

  let postedRate: number;
  let maxBuy: number;
  try {
    postedRate = tmsPaddedInt(record.get(TMS_FIELD.RATE) ?? "", TMS_FIELD.RATE);
    const maxRaw = record.get(TMS_FIELD.MAX_BUY);
    if (maxRaw === undefined || maxRaw.trim() === "") {
      throw new BridgeError(
        "CEILING_UNAVAILABLE",
        "Ceiling not available for this load",
        503,
        true,
      );
    }
    maxBuy = tmsPaddedInt(maxRaw, TMS_FIELD.MAX_BUY);
  } catch (err) {
    if (err instanceof BridgeError) {
      throw err;
    }
    throw new BridgeError("TMS_BAD_RESPONSE", "Invalid load pricing fields", 502, true);
  }

  return {
    postedRate,
    maxBuy,
    loadAvailable: true,
  };
}

export async function fetchLoadPricing(
  client: TmsClient,
  tmsToken: string,
  loadId: string,
): Promise<LoadPricingSnapshot> {
  const record = await fetchLoadRecord(client, tmsToken, loadId);
  return parseLoadPricingFromRecord(record);
}
