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
