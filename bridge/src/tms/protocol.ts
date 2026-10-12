import { BridgeError } from "../http/errors.ts";
import type {
  EchoResponse,
  LoadQueryFilters,
  ParsedTmsResponse,
  TmsCommand,
  TmsWireError,
} from "./types.ts";


/* --- constants.ts --- */
/** D4 — TMS client deadlines (ms). */
export const TMS_CONNECT_MS = 800;
export const TMS_RESPONSE_MS = 2_500;
export const TMS_READ_MAX_ATTEMPTS = 2;
export const TMS_READ_BACKOFF_MS = 200;
export const TMS_MAX_FRAME_BYTES = 4096;

/* --- validate-value.ts --- */
/** Handbook: values must not contain `|` or CRLF. */
export function assertTmsFieldValue(value: string, field: string): void {
  if (value.includes("|") || value.includes("\r") || value.includes("\n")) {
    throw new Error(`TMS field ${field} contains forbidden delimiter`);
  }
  for (const ch of value) {
    if (ch.charCodeAt(0) > 127) {
      throw new Error(`TMS field ${field} must be ASCII`);
    }
  }
}

/* --- encode-request.ts --- */
/**
 * Single-line TMS request. CMD first, AUTH second, then extra fields (handbook order).
 */
export function encodeTmsRequest(
  cmd: TmsCommand,
  auth: string,
  fields: Record<string, string>,
): string {
  assertTmsFieldValue(auth, "AUTH");
  for (const [key, value] of Object.entries(fields)) {
    assertTmsFieldValue(value, key);
  }

  const segments = [`CMD:${cmd}`, `AUTH:${auth}`];
  for (const [key, value] of Object.entries(fields)) {
    segments.push(`${key}:${value}`);
  }
  return `${segments.join("|")}\r\n`;
}

/* --- fields.ts --- */
/**
 * TMS wire field names (handbook / spec). Use these instead of string literals
 * when reading or writing record maps and request bodies.
 */
export const TMS_FIELD = {
  CMD: "CMD",
  AUTH: "AUTH",
  MSG: "MSG",

  LOAD_ID: "LOAD_ID",
  ORIG_CITY: "ORIG_CITY",
  ORIG_STATE: "ORIG_STATE",
  ORIG_ZIP: "ORIG_ZIP",
  DEST_CITY: "DEST_CITY",
  DEST_STATE: "DEST_STATE",
  DEST_ZIP: "DEST_ZIP",
  PICKUP_DT: "PICKUP_DT",
  DELIVERY_DT: "DELIVERY_DT",
  EQTYPE: "EQTYPE",
  RATE: "RATE",
  MAX_BUY: "MAX_BUY",
  WEIGHT: "WEIGHT",
  COMMODITY: "COMMODITY",
  PIECES: "PIECES",
  MILES: "MILES",
  DIMS: "DIMS",
  NOTES: "NOTES",
  STATUS: "STATUS",

  MAX_RESULTS: "MAX_RESULTS",
  MC_NUM: "MC_NUM",
  AGREED_RATE: "AGREED_RATE",
  BOOKING_REF: "BOOKING_REF",
  TIMESTAMP: "TIMESTAMP",
} as const;

export type TmsFieldKey = (typeof TMS_FIELD)[keyof typeof TMS_FIELD];

export const TMS_LOAD_STATUS = {
  OPEN: "OPEN",
  /** Live TMS may return PENDING on LOAD_BOOK success before GET catches up. */
  PENDING: "PENDING",
  BOOKED: "BOOKED",
} as const;

/** Fields emitted on LOAD_QUERY result rows. */
export const TMS_QUERY_SUMMARY_FIELDS = [
  TMS_FIELD.LOAD_ID,
  TMS_FIELD.ORIG_CITY,
  TMS_FIELD.ORIG_STATE,
  TMS_FIELD.ORIG_ZIP,
  TMS_FIELD.DEST_CITY,
  TMS_FIELD.DEST_STATE,
  TMS_FIELD.DEST_ZIP,
  TMS_FIELD.PICKUP_DT,
  TMS_FIELD.EQTYPE,
  TMS_FIELD.RATE,
  TMS_FIELD.MILES,
  TMS_FIELD.STATUS,
] as const satisfies readonly TmsFieldKey[];

/** Field order for fake / test LOAD_GET lines (handbook-shaped). */
export const TMS_FULL_LOAD_FIELD_ORDER = [
  TMS_FIELD.LOAD_ID,
  TMS_FIELD.ORIG_CITY,
  TMS_FIELD.ORIG_STATE,
  TMS_FIELD.ORIG_ZIP,
  TMS_FIELD.DEST_CITY,
  TMS_FIELD.DEST_STATE,
  TMS_FIELD.DEST_ZIP,
  TMS_FIELD.PICKUP_DT,
  TMS_FIELD.DELIVERY_DT,
  TMS_FIELD.EQTYPE,
  TMS_FIELD.RATE,
  TMS_FIELD.WEIGHT,
  TMS_FIELD.COMMODITY,
  TMS_FIELD.PIECES,
  TMS_FIELD.MILES,
  TMS_FIELD.DIMS,
  TMS_FIELD.NOTES,
  TMS_FIELD.STATUS,
  TMS_FIELD.MAX_BUY,
] as const satisfies readonly TmsFieldKey[];

/* --- commands.ts --- */
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

/* --- parser.ts --- */
export function parseRecordLine(line: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const segment of line.split("|")) {
    const idx = segment.indexOf(":");
    if (idx === -1) {
      continue;
    }
    const key = segment.slice(0, idx);
    const value = segment.slice(idx + 1).trimEnd();
    map.set(key, value);
  }
  return map;
}

function parseErrorLine(line: string): TmsWireError | null {
  if (!line.startsWith("ERR|")) {
    return null;
  }
  const map = new Map<string, string>();
  for (const segment of line.split("|").slice(1)) {
    const idx = segment.indexOf(":");
    if (idx === -1) {
      continue;
    }
    map.set(segment.slice(0, idx), segment.slice(idx + 1).trimEnd());
  }
  const code = map.get("CODE") ?? "SERVER_ERROR";
  const message = map.get("MSG") ?? "unknown TMS error";
  return { code, message };
}

/**
 * Parse full TMS response lines (excluding CRLF). Requires END or ERR.
 */
export function parseTmsResponse(lines: string[]): ParsedTmsResponse {
  if (lines.length === 0) {
    throw new Error("TMS_EMPTY_RESPONSE");
  }

  const err = parseErrorLine(lines[0]!);
  if (err) {
    return { kind: "error", wire: err };
  }

  if (!lines.includes("END")) {
    throw new Error("TMS_PARTIAL_RESPONSE");
  }

  const records: Map<string, string>[] = [];
  for (const line of lines) {
    if (line === "END" || line.startsWith("ERR|") || line.startsWith("ECHO|")) {
      continue;
    }
    if (line.includes("::") || line.endsWith("|")) {
      throw new Error("TMS_MALFORMED_RESPONSE");
    }
    records.push(parseRecordLine(line));
  }

  return { kind: "success", records };
}

/* --- parse-echo.ts --- */
/** Parse the single `ECHO|...` success line from DEBUG_ECHO. */
export function parseDebugEchoLine(line: string): EchoResponse {
  if (!line.startsWith("ECHO|")) {
    return { auth_ok: false, msg: null, fields_parsed: null };
  }

  const parts = line.split("|");
  let auth_ok = false;
  let msg: string | null = null;
  let fields_parsed: number | null = null;

  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const key = part.slice(0, idx);
    const value = part.slice(idx + 1);
    if (key === "AUTH") auth_ok = value === "OK";
    if (key === "MSG") msg = value;
    if (key === "FIELDS_PARSED") {
      const n = Number.parseInt(value, 10);
      fields_parsed = Number.isNaN(n) ? null : n;
    }
  }

  return { auth_ok, msg, fields_parsed };
}

export function debugEchoMatchesRequest(
  line: string,
  expectedMsg: string,
): boolean {
  const parsed = parseDebugEchoLine(line);
  return parsed.auth_ok && parsed.msg === expectedMsg;
}

/* --- map-wire-error.ts --- */
export function bridgeErrorFromTmsWire(code: string, message: string): BridgeError {
  switch (code) {
    case "UNKNOWN_LOAD":
      return new BridgeError("LOAD_NOT_FOUND", message, 404);
    case "INVALID_RATE":
      return new BridgeError("RATE_NOT_ACCEPTABLE", message, 422, false);
    case "ALREADY_BOOKED":
      return new BridgeError("LOAD_UNAVAILABLE", message, 409, false);
    case "AUTH_FAILED":
      return new BridgeError("TMS_UNAVAILABLE", "TMS authentication failed", 503, true);
    case "SERVER_ERROR":
      return new BridgeError("TMS_UNAVAILABLE", message, 503, true);
    case "MALFORMED":
      return new BridgeError("TMS_BAD_RESPONSE", message, 502);
    default:
      return new BridgeError("TMS_UNAVAILABLE", message, 503, true);
  }
}

/* --- fetch-load-record.ts --- */
type TmsReadClient = {
  executeRead(requestLine: string, label: string): Promise<ParsedTmsResponse>;
};

/** LOAD_GET → record map; typed BridgeError on wire/transport failure. */
export async function fetchLoadRecord(
  client: TmsReadClient,
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
