import { z } from "zod";
import { validationError } from "../http/errors.ts";
import { TMS_FIELD, TMS_LOAD_STATUS, type TmsFieldKey } from "../tms/protocol.ts";
import type { LoadQueryFilters } from "../tms/types.ts";
import type { NormalizedSearchLoads, SafeLoad, SearchLoadsRequestBody } from "./types.ts";


/* --- tms-record.ts --- */
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

/**
 * Handbook / PoC rule: only `OPEN` loads accept LOAD_BOOK and may be pitched.
 * `BOOKED` is taken; `PENDING` is held (e.g. after a tentative book); other statuses are not offered.
 */
export function isBookableLoad(record: Map<string, string>): boolean {
  const status = record.get(TMS_FIELD.STATUS);
  return status !== undefined && tmsTrim(status) === TMS_LOAD_STATUS.OPEN;
}

/** @deprecated Use {@link isBookableLoad} — same rule (OPEN only). */
export function isOpenStatus(record: Map<string, string>): boolean {
  return isBookableLoad(record);
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

/* --- map-safe-load.ts --- */
function requireField(record: Map<string, string>, key: TmsFieldKey): string {
  const value = record.get(key);
  if (value === undefined || tmsTrim(value) === "") {
    throw new Error(`TMS_MISSING:${key}`);
  }
  return value;
}

/** Handbook full records include these; live TMS rows may omit or pad blank. */
function optionalTextField(record: Map<string, string>, key: TmsFieldKey): string {
  const value = record.get(key);
  if (value === undefined) {
    return "";
  }
  return tmsTrim(value);
}

function optionalPaddedInt(record: Map<string, string>, key: TmsFieldKey): number {
  const value = record.get(key);
  if (value === undefined || tmsTrim(value) === "") {
    return 0;
  }
  return tmsPaddedInt(value, key);
}

function optionalDeliveryIso(record: Map<string, string>): string {
  const raw = record.get(TMS_FIELD.DELIVERY_DT);
  if (raw === undefined || tmsTrim(raw) === "") {
    return "";
  }
  return tmsDateTimeToIso(raw);
}

/** LOAD_QUERY summary rows — no GET; cargo/detail fields may be absent. */
export function mapTmsSearchRowToSafeLoad(record: Map<string, string>): SafeLoad {
  const F = TMS_FIELD;
  return {
    id: tmsTrim(requireField(record, F.LOAD_ID)),
    origin: {
      city: tmsTrim(requireField(record, F.ORIG_CITY)),
      state: tmsTrim(requireField(record, F.ORIG_STATE)),
      zip: tmsTrim(requireField(record, F.ORIG_ZIP)),
    },
    destination: {
      city: tmsTrim(requireField(record, F.DEST_CITY)),
      state: tmsTrim(requireField(record, F.DEST_STATE)),
      zip: tmsTrim(requireField(record, F.DEST_ZIP)),
    },
    pickup_at: tmsDateTimeToIso(requireField(record, F.PICKUP_DT)),
    delivery_at: optionalDeliveryIso(record),
    equipment_type: tmsTrim(requireField(record, F.EQTYPE)),
    loadboard_rate: tmsPaddedInt(requireField(record, F.RATE), F.RATE),
    miles: tmsPaddedInt(requireField(record, F.MILES), F.MILES),
    weight: optionalPaddedInt(record, F.WEIGHT),
    commodity: optionalTextField(record, F.COMMODITY),
    pieces: optionalPaddedInt(record, F.PIECES),
    dimensions: optionalTextField(record, F.DIMS),
    notes: optionalTextField(record, F.NOTES),
  };
}

/** Full LOAD_GET record — all handbook fields expected. */
export function mapTmsRecordToSafeLoad(record: Map<string, string>): SafeLoad {
  const F = TMS_FIELD;
  return {
    id: tmsTrim(requireField(record, F.LOAD_ID)),
    origin: {
      city: tmsTrim(requireField(record, F.ORIG_CITY)),
      state: tmsTrim(requireField(record, F.ORIG_STATE)),
      zip: tmsTrim(requireField(record, F.ORIG_ZIP)),
    },
    destination: {
      city: tmsTrim(requireField(record, F.DEST_CITY)),
      state: tmsTrim(requireField(record, F.DEST_STATE)),
      zip: tmsTrim(requireField(record, F.DEST_ZIP)),
    },
    pickup_at: tmsDateTimeToIso(requireField(record, F.PICKUP_DT)),
    delivery_at: tmsDateTimeToIso(requireField(record, F.DELIVERY_DT)),
    equipment_type: tmsTrim(requireField(record, F.EQTYPE)),
    loadboard_rate: tmsPaddedInt(requireField(record, F.RATE), F.RATE),
    miles: tmsPaddedInt(requireField(record, F.MILES), F.MILES),
    weight: tmsPaddedInt(requireField(record, F.WEIGHT), F.WEIGHT),
    commodity: tmsTrim(requireField(record, F.COMMODITY)),
    pieces: tmsPaddedInt(requireField(record, F.PIECES), F.PIECES),
    dimensions: optionalTextField(record, F.DIMS),
    notes: optionalTextField(record, F.NOTES),
  };
}

/* --- normalize-search-input.ts --- */
const STATE_CODE = /^[A-Z]{2}$/;

function blankToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function normalizeState(
  field: "origin_state" | "dest_state",
  raw: string | undefined,
): string | undefined {
  const trimmed = blankToUndefined(raw);
  if (trimmed === undefined) {
    return undefined;
  }
  const upper = trimmed.toUpperCase();
  if (!STATE_CODE.test(upper)) {
    throw validationError(
      `${field} must be a 2-letter state code (handbook: state matches exactly)`,
    );
  }
  return upper;
}

/**
 * Handbook: equipment filter required for our API; LOAD_QUERY needs ≥1 filter (EQTYPE alone is valid).
 * Empty strings from the workflow mean "not provided".
 */
export function normalizeSearchLoadsInput(
  body: SearchLoadsRequestBody,
): NormalizedSearchLoads {
  const equipmentRaw = body.equipment_type.trim();
  if (equipmentRaw === "") {
    throw validationError("equipment_type is required");
  }

  return {
    equipment_type: equipmentRaw.toUpperCase(),
    origin_city: blankToUndefined(body.origin_city),
    origin_state: normalizeState("origin_state", body.origin_state),
    dest_state: normalizeState("dest_state", body.dest_state),
    pickup_date: blankToUndefined(body.pickup_date),
  };
}

/* --- parse-search-body.ts --- */
/** Accept optional fields as any string (including ""); normalization drops blanks. */
const searchLoadsBodySchema = z.object({
  equipment_type: z.string(),
  origin_city: z.string().optional(),
  origin_state: z.string().optional(),
  dest_state: z.string().optional(),
  pickup_date: z.string().optional(),
});

export function parseSearchLoadsInput(body: unknown): NormalizedSearchLoads {
  const parsed = searchLoadsBodySchema.parse(body);
  return normalizeSearchLoadsInput(parsed);
}

/* --- to-tms-filters.ts --- */
/** Map bridge search input to TMS LOAD_QUERY fields (omit unset filters). */
export function toLoadQueryFilters(input: NormalizedSearchLoads): LoadQueryFilters {
  const filters: LoadQueryFilters = {
    eqtype: input.equipment_type,
  };
  if (input.origin_state) {
    filters.orig_state = input.origin_state;
  }
  if (input.dest_state) {
    filters.dest_state = input.dest_state;
  }
  if (input.origin_city) {
    filters.orig_city = input.origin_city;
  }
  return filters;
}

/* --- assert-safe-search-json.ts --- */
/** Search responses may include loadboard_rate; never ceiling or MAX_BUY. */
export function assertSafeSearchJson(json: string): void {
  if (/max_buy|maxbuy|ceiling|MAX_BUY/i.test(json)) {
    throw new Error("search response leaks ceiling");
  }
}
