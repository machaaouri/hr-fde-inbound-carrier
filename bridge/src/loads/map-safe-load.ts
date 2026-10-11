import { TMS_FIELD, type TmsFieldKey } from "../tms/fields.ts";
import type { SafeLoad } from "./safe-load-types.ts";
import { tmsDateTimeToIso, tmsPaddedInt, tmsTrim } from "./tms-record.ts";

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
