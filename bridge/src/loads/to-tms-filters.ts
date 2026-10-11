import type { LoadQueryFilters } from "../tms/types.ts";
import type { NormalizedSearchLoads } from "./types.ts";

/** Map bridge search input to TMS LOAD_QUERY fields (omit unset filters). */
export function toLoadQueryFilters(input: NormalizedSearchLoads): LoadQueryFilters {
  const filters: LoadQueryFilters = {
    eqtype: input.equipment_type,
  };
  if (input.origin_state) {
    filters.orig_state = input.origin_state;
  }
  if (input.dest_state) {
    filters.dest_state = input.dest_state;
  }
  if (input.origin_city) {
    filters.orig_city = input.origin_city;
  }
  return filters;
}
