import { encodeLoadQuery } from "../tms/commands.ts";
import type { TmsClient } from "../tms/client.ts";
import { unwrapTmsResponse } from "../tms/client.ts";
import { mapTmsSearchRowToSafeLoad } from "./map-safe-load.ts";
import type { SearchLoadsResponse } from "./safe-load-types.ts";
import {
  isBookableLoad,
  isFuturePickup,
  matchesPickupDateFilter,
} from "./tms-record.ts";
import { toLoadQueryFilters } from "./to-tms-filters.ts";
import type { NormalizedSearchLoads } from "./types.ts";

const QUERY_MAX_RESULTS = 50;
const MAX_SAFE_LOADS = 3;

/**
 * Lane search uses LOAD_QUERY only. TMS LOAD_GET runs later for the carrier's
 * chosen load_id (offers/decide, booking), where MAX_BUY and full detail live.
 */
export async function searchLoads(
  client: TmsClient,
  tmsToken: string,
  input: NormalizedSearchLoads,
): Promise<SearchLoadsResponse> {
  const filters = {
    ...toLoadQueryFilters(input),
    max_results: QUERY_MAX_RESULTS,
  };
  const queryLine = encodeLoadQuery(tmsToken, filters);
  const queryParsed = await client.executeRead(queryLine, "LOAD_QUERY");
  const queryRecords = unwrapTmsResponse(queryParsed);

  const loads: SearchLoadsResponse["loads"] = [];

  for (const record of queryRecords) {
    if (loads.length >= MAX_SAFE_LOADS) {
      break;
    }
    if (!isBookableLoad(record)) {
      continue;
    }
    if (!isFuturePickup(record)) {
      continue;
    }
    if (!matchesPickupDateFilter(record, input.pickup_date)) {
      continue;
    }
    try {
      loads.push(mapTmsSearchRowToSafeLoad(record));
    } catch {
      continue;
    }
  }

  return { loads };
}
