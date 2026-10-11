import type { ParsedTmsResponse, TmsWireError } from "./parser-types.ts";

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
