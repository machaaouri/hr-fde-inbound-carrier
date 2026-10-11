import { TMS_FIELD, TMS_LOAD_STATUS } from "../tms/fields.ts";

export function tmsTrim(value: string): string {
  return value.trim();
}

export function tmsPaddedInt(value: string, field: string): number {
  const n = Number.parseInt(value.trim(), 10);
  if (Number.isNaN(n)) {
    throw new Error(`TMS_BAD_FIELD:${field}`);
  }
  return n;
}

/** Handbook timestamps: YYYYMMDDHHMMSS (UTC). */
export function tmsDateTimeToIso(value: string): string {
  const s = value.trim();
  if (s.length !== 14) {
    throw new Error("TMS_BAD_DATETIME");
  }
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(4, 6)) - 1;
  const d = Number(s.slice(6, 8));
  const h = Number(s.slice(8, 10));
  const mi = Number(s.slice(10, 12));
  const sec = Number(s.slice(12, 14));
  return new Date(Date.UTC(y, mo, d, h, mi, sec)).toISOString();
}

export function pickupDateKeyFromTms(value: string): string {
  return value.trim().slice(0, 8);
}

export function isOpenStatus(record: Map<string, string>): boolean {
  const status = record.get(TMS_FIELD.STATUS);
  return status !== undefined && tmsTrim(status) === TMS_LOAD_STATUS.OPEN;
}

export function isFuturePickup(record: Map<string, string>, nowMs = Date.now()): boolean {
  const raw = record.get(TMS_FIELD.PICKUP_DT);
  if (!raw) {
    return false;
  }
  const pickupMs = Date.parse(tmsDateTimeToIso(raw));
  return pickupMs > nowMs;
}

export function matchesPickupDateFilter(
  record: Map<string, string>,
  pickupDate: string | undefined,
): boolean {
  if (!pickupDate) {
    return true;
  }
  const raw = record.get(TMS_FIELD.PICKUP_DT);
  if (!raw) {
    return false;
  }
  const filterKey = pickupDate.replaceAll("-", "");
  return pickupDateKeyFromTms(raw) === filterKey;
}
