/** Shared parsing for Twin-shaped webhook fields (decide + bookings). */

export type OfferHistoryRow = {
  load_id: string;
  round: number;
  carrier_counter: number | null;
  broker_offer: number | null;
  decision: string;
};

export type DerivedNegotiationState = {
  max_round: number;
  latest_broker_offer: number | null;
};

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
    return [];
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
    return { max_round: 0, latest_broker_offer: null };
  }
  let max_round = 0;
  for (const row of forLoad) {
    if (row.round > max_round) {
      max_round = row.round;
    }
  }
  let latest_broker_offer: number | null = null;
  for (const row of forLoad) {
    if (row.broker_offer !== null) {
      latest_broker_offer = row.broker_offer;
    }
  }
  return { max_round, latest_broker_offer };
}

function isAcceptDecision(decision: string): boolean {
  return decision.toUpperCase() === "ACCEPT";
}

/** Agreed dollars from the latest ACCEPT row for this load (array order). */
export function agreedRateFromAcceptHistory(
  loadId: string,
  rows: OfferHistoryRow[],
): number | null {
  let agreed: number | null = null;
  for (const row of rows) {
    if (row.load_id !== loadId || !isAcceptDecision(row.decision)) {
      continue;
    }
    const fromBroker = row.broker_offer;
    const fromCounter = row.carrier_counter;
    if (fromBroker !== null) {
      agreed = fromBroker;
    } else if (fromCounter !== null) {
      agreed = fromCounter;
    }
  }
  return agreed;
}

export function normalizeChallengeStatus(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return "";
  }
  return typeof raw === "string" ? raw.trim() : String(raw).trim();
}
