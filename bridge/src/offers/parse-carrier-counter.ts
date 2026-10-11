export type CarrierCounterParse =
  | { kind: "empty" }
  | { kind: "ok"; dollars: number }
  | { kind: "invalid" };

/** Strip `$`, commas, spaces; drop decimal fraction → whole USD. */
export function parseCarrierCounterRaw(raw: string): CarrierCounterParse {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { kind: "empty" };
  }

  let s = trimmed.replace(/\$/g, "").replace(/,/g, "").replace(/\s/g, "");
  const dot = s.indexOf(".");
  if (dot !== -1) {
    const whole = s.slice(0, dot);
    const frac = s.slice(dot + 1);
    if (!/^\d*$/.test(whole) || (frac !== "" && !/^\d*$/.test(frac))) {
      return { kind: "invalid" };
    }
    s = whole === "" ? "0" : whole;
  }

  if (!/^\d+$/.test(s)) {
    return { kind: "invalid" };
  }

  const dollars = Number.parseInt(s, 10);
  if (!Number.isSafeInteger(dollars) || dollars <= 0) {
    return { kind: "invalid" };
  }

  return { kind: "ok", dollars };
}
