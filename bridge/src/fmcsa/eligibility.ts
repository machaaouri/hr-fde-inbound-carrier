import type { VerifyCarrierResult } from "./types.ts";

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


function yn(value: unknown): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === "Y";
}

function statusCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const s = value.trim().toUpperCase();
  return s === "" ? null : s;
}

function pickEmail(carrier: Record<string, unknown>): string | undefined {
  for (const key of ["emailAddress", "email", "emailAddr"]) {
    const v = carrier[key];
    if (typeof v === "string" && v.includes("@")) {
      return v.trim();
    }
  }
  return undefined;
}

function hasActiveForHireAuthority(row: Record<string, unknown>): boolean {
  const common = statusCode(row.commonAuthorityStatus);
  const contract = statusCode(row.contractAuthorityStatus);
  return common === "A" || contract === "A";
}

function isOutOfService(carrier: Record<string, unknown>): boolean {
  if (yn(carrier.outOfService)) {
    return true;
  }
  const oosDate = carrier.oosDate;
  if (oosDate === null || oosDate === undefined) {
    return false;
  }
  if (typeof oosDate === "string" && oosDate.trim() === "") {
    return false;
  }
  return true;
}

export function evaluateCarrierEligibility(
  carrier: Record<string, unknown>,
  authorityRows: Record<string, unknown>[],
): VerifyCarrierResult {
  const dotRaw = carrier.dotNumber ?? carrier.dot;
  const dot =
    typeof dotRaw === "number"
      ? String(dotRaw)
      : typeof dotRaw === "string"
        ? dotRaw.trim()
        : undefined;

  const legalName =
    typeof carrier.legalName === "string" ? carrier.legalName.trim() : undefined;

  const base = {
    carrier_name: legalName,
    dot_number: dot,
    contact_email: pickEmail(carrier),
  };

  if (isOutOfService(carrier)) {
    return { eligible: false, reason: "OUT_OF_SERVICE", ...base };
  }

  if (!yn(carrier.allowedToOperate)) {
    return { eligible: false, reason: "NOT_AUTHORIZED", ...base };
  }

  const docketActive = hasActiveForHireAuthority(carrier);
  const authorityActive = authorityRows.some(hasActiveForHireAuthority);
  if (!docketActive && !authorityActive) {
    return { eligible: false, reason: "NOT_AUTHORIZED", ...base };
  }

  return { eligible: true, reason: "ACTIVE", ...base };
}

export function notFoundResult(): VerifyCarrierResult {
  return { eligible: false, reason: "NOT_FOUND" };
}
