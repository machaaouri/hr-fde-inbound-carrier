import { encodeTmsRequest } from "./encode-request.ts";
import { TMS_FIELD } from "./fields.ts";
import type { LoadQueryFilters } from "./types.ts";

/** Handbook: /spec/debug-echo/ — echo body is MSG, not PAYLOAD. */
export function encodeDebugEcho(auth: string, msg: string): string {
  return encodeTmsRequest("DEBUG_ECHO", auth, { [TMS_FIELD.MSG]: msg });
}

export function encodeLoadQuery(
  auth: string,
  filters: LoadQueryFilters,
): string {
  const fields: Record<string, string> = {};
  if (filters.orig_state) fields[TMS_FIELD.ORIG_STATE] = filters.orig_state;
  if (filters.dest_state) fields[TMS_FIELD.DEST_STATE] = filters.dest_state;
  if (filters.orig_city) fields[TMS_FIELD.ORIG_CITY] = filters.orig_city;
  if (filters.eqtype) fields[TMS_FIELD.EQTYPE] = filters.eqtype;
  if (filters.max_results !== undefined) {
    fields[TMS_FIELD.MAX_RESULTS] = String(filters.max_results);
  }
  if (Object.keys(fields).length === 0) {
    throw new Error("LOAD_QUERY requires at least one filter field");
  }
  return encodeTmsRequest("LOAD_QUERY", auth, fields);
}

export function encodeLoadGet(auth: string, loadId: string): string {
  return encodeTmsRequest("LOAD_GET", auth, { [TMS_FIELD.LOAD_ID]: loadId });
}

export function encodeLoadBook(
  auth: string,
  loadId: string,
  mcNum: string,
  agreedRate: number,
): string {
  return encodeTmsRequest("LOAD_BOOK", auth, {
    [TMS_FIELD.LOAD_ID]: loadId,
    [TMS_FIELD.MC_NUM]: mcNum,
    [TMS_FIELD.AGREED_RATE]: String(agreedRate),
  });
}
