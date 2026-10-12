/** Shared parsing for Twin-shaped webhook fields (decide + bookings). */

export type OfferHistoryRow = {
  load_id: string;
  round: number;
  carrier_counter: number | null;
  broker_offer: number | null;
  decision: string;
};

export type DerivedNegotiationState = {
  rounds_used: number;
  standing_offer: number | null;
  latest_broker_offer: number | null;
};

export type WorkflowInputStyle = "legacy" | "source";

/**
 * Twin nullable dollar fields → whole USD or null (unparsable / empty string).
 */
export function parseTwinDollarField(raw: unknown): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw <= 0) {
      return null;
    }
    return raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") {
      return null;
    }
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }
    const value = Number.parseInt(trimmed, 10);
    if (value <= 0) {
      return null;
    }
    return value;
  }
  return null;
}

export function parseTwinIntField(raw: unknown, fallback = 0): number {
  if (raw === null || raw === undefined) {
    return fallback;
  }
  if (typeof raw === "number" && Number.isInteger(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") {
      return fallback;
    }
    const value = Number.parseInt(trimmed, 10);
    return Number.isInteger(value) ? value : fallback;
  }
  return fallback;
}

export function defaultOutcome(raw: unknown): string {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed === "" ? "abandoned" : trimmed;
}

export function sameNegotiationLoad(
  loadId: string,
  currentLoadId: string,
): boolean {
  return (
    loadId !== "" &&
    currentLoadId !== "" &&
    loadId === currentLoadId
  );
}

export function parseOffersHistoryRaw(raw: unknown): OfferHistoryRow[] | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") {
      return [];
    }
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const rows: OfferHistoryRow[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const rec = item as Record<string, unknown>;
    const load_id = String(rec.load_id ?? "").trim();
    if (load_id === "") {
      continue;
    }
    rows.push({
      load_id,
      round: parseTwinIntField(rec.round, 0),
      carrier_counter: parseTwinDollarField(rec.carrier_counter),
      broker_offer: parseTwinDollarField(rec.broker_offer),
      decision: String(rec.decision ?? "").trim(),
    });
  }
  return rows;
}

/** For one load: max round; latest non-null broker_offer in array order. */
export function deriveNegotiationFromHistory(
  loadId: string,
  rows: OfferHistoryRow[],
): DerivedNegotiationState {
  const forLoad = rows.filter((r) => r.load_id === loadId);
  if (forLoad.length === 0) {
    return {
      rounds_used: 0,
      standing_offer: null,
      latest_broker_offer: null,
    };
  }
  let rounds_used = 0;
  for (const row of forLoad) {
    if (row.round > rounds_used) {
      rounds_used = row.round;
    }
  }
  let standing_offer: number | null = null;
  for (const row of forLoad) {
    if (row.broker_offer !== null) {
      standing_offer = row.broker_offer;
    }
  }
  return {
    rounds_used,
    standing_offer,
    latest_broker_offer: standing_offer,
  };
}

export type VerificationResolution = {
  otp_status: string;
  usedChallengeStatus: boolean;
};

/** `otp_challenge_status` (Twin otp_challenges.status) wins over `otp_status` when present. */
export function resolveVerificationStatus(
  otpStatusRaw: unknown,
  otpChallengeStatusRaw: unknown,
): VerificationResolution {
  const challengePresent =
    otpChallengeStatusRaw !== null &&
    otpChallengeStatusRaw !== undefined &&
    !(
      typeof otpChallengeStatusRaw === "string" &&
      otpChallengeStatusRaw.trim() === ""
    );
  if (challengePresent) {
    const status =
      typeof otpChallengeStatusRaw === "string"
        ? otpChallengeStatusRaw.trim()
        : String(otpChallengeStatusRaw);
    return { otp_status: status, usedChallengeStatus: true };
  }
  const legacy = typeof otpStatusRaw === "string" ? otpStatusRaw.trim() : "";
  return {
    otp_status: legacy === "" ? "pending" : legacy,
    usedChallengeStatus: false,
  };
}

export function negotiationFieldDisagreements(
  legacy: { rounds_used: number; standing_offer: number | null },
  derived: DerivedNegotiationState,
): string[] {
  const disagreements: string[] = [];
  if (legacy.rounds_used !== derived.rounds_used) {
    disagreements.push("rounds_used");
  }
  const legacyStanding = legacy.standing_offer;
  const derivedStanding = derived.standing_offer;
  if (legacyStanding !== derivedStanding) {
    disagreements.push("standing_offer");
  }
  if (disagreements.length > 0) {
    return disagreements;
  }
  return [];
}

export function verificationFieldDisagreements(
  legacyOtpStatus: string,
  resolvedOtpStatus: string,
  usedChallengeStatus: boolean,
): string[] {
  if (!usedChallengeStatus) {
    return [];
  }
  const legacyNorm = legacyOtpStatus.trim() === "" ? "pending" : legacyOtpStatus.trim();
  if (legacyNorm !== resolvedOtpStatus) {
    return ["otp_status", "otp_challenge_status"];
  }
  return [];
}
