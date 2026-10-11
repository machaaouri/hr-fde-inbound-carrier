import type { EchoResponse } from "./types.ts";

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
