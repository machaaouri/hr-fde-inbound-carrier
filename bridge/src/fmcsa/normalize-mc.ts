/** Strip MC/MC- prefix and non-digits; returns null if no usable docket digits. */
export function normalizeMcDocket(raw: string): string | null {
  let s = raw.trim().toUpperCase();
  if (s.startsWith("MC-")) {
    s = s.slice(3);
  } else if (s.startsWith("MC")) {
    s = s.slice(2);
  }
  const digits = s.replace(/\D/g, "");
  if (digits.length < 1 || digits.length > 8) {
    return null;
  }
  return digits;
}
