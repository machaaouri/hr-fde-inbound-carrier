/**
 * TMS wire field names (handbook / spec). Use these instead of string literals
 * when reading or writing record maps and request bodies.
 */
export const TMS_FIELD = {
  CMD: "CMD",
  AUTH: "AUTH",
  MSG: "MSG",

  LOAD_ID: "LOAD_ID",
  ORIG_CITY: "ORIG_CITY",
  ORIG_STATE: "ORIG_STATE",
  ORIG_ZIP: "ORIG_ZIP",
  DEST_CITY: "DEST_CITY",
  DEST_STATE: "DEST_STATE",
  DEST_ZIP: "DEST_ZIP",
  PICKUP_DT: "PICKUP_DT",
  DELIVERY_DT: "DELIVERY_DT",
  EQTYPE: "EQTYPE",
  RATE: "RATE",
  MAX_BUY: "MAX_BUY",
  WEIGHT: "WEIGHT",
  COMMODITY: "COMMODITY",
  PIECES: "PIECES",
  MILES: "MILES",
  DIMS: "DIMS",
  NOTES: "NOTES",
  STATUS: "STATUS",

  MAX_RESULTS: "MAX_RESULTS",
  MC_NUM: "MC_NUM",
  AGREED_RATE: "AGREED_RATE",
} as const;

export type TmsFieldKey = (typeof TMS_FIELD)[keyof typeof TMS_FIELD];

export const TMS_LOAD_STATUS = {
  OPEN: "OPEN",
  BOOKED: "BOOKED",
} as const;

/** Fields emitted on LOAD_QUERY result rows. */
export const TMS_QUERY_SUMMARY_FIELDS = [
  TMS_FIELD.LOAD_ID,
  TMS_FIELD.ORIG_CITY,
  TMS_FIELD.ORIG_STATE,
  TMS_FIELD.ORIG_ZIP,
  TMS_FIELD.DEST_CITY,
  TMS_FIELD.DEST_STATE,
  TMS_FIELD.DEST_ZIP,
  TMS_FIELD.PICKUP_DT,
  TMS_FIELD.EQTYPE,
  TMS_FIELD.RATE,
  TMS_FIELD.MILES,
  TMS_FIELD.STATUS,
] as const satisfies readonly TmsFieldKey[];

/** Field order for fake / test LOAD_GET lines (handbook-shaped). */
export const TMS_FULL_LOAD_FIELD_ORDER = [
  TMS_FIELD.LOAD_ID,
  TMS_FIELD.ORIG_CITY,
  TMS_FIELD.ORIG_STATE,
  TMS_FIELD.ORIG_ZIP,
  TMS_FIELD.DEST_CITY,
  TMS_FIELD.DEST_STATE,
  TMS_FIELD.DEST_ZIP,
  TMS_FIELD.PICKUP_DT,
  TMS_FIELD.DELIVERY_DT,
  TMS_FIELD.EQTYPE,
  TMS_FIELD.RATE,
  TMS_FIELD.WEIGHT,
  TMS_FIELD.COMMODITY,
  TMS_FIELD.PIECES,
  TMS_FIELD.MILES,
  TMS_FIELD.DIMS,
  TMS_FIELD.NOTES,
  TMS_FIELD.STATUS,
  TMS_FIELD.MAX_BUY,
] as const satisfies readonly TmsFieldKey[];
