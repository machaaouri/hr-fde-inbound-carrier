import type { TmsCommand } from "./types.ts";
import { assertTmsFieldValue } from "./validate-value.ts";

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
