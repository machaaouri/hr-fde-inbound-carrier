import { TMS_FIELD } from "../fields.ts";
import { parseRecordLine } from "../parser.ts";

export type ParsedTmsRequest = {
  cmd: string;
  auth: string;
  fields: Map<string, string>;
};

export function parseTmsRequestLine(line: string): ParsedTmsRequest {
  const trimmed = line.replace(/\r\n$/, "");
  const map = parseRecordLine(trimmed);
  const cmd = map.get(TMS_FIELD.CMD);
  const auth = map.get(TMS_FIELD.AUTH);
  if (!cmd || !auth) {
    throw new Error("MALFORMED_REQUEST");
  }
  map.delete(TMS_FIELD.CMD);
  map.delete(TMS_FIELD.AUTH);
  return { cmd, auth, fields: map };
}
