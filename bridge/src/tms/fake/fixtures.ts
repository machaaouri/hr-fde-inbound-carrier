import {
  TMS_FULL_LOAD_FIELD_ORDER,
  TMS_QUERY_SUMMARY_FIELDS,
} from "../fields.ts";
import { parseRecordLine } from "../parser.ts";

/** Full LOAD_GET lines (handbook-shaped). MAX_BUY present on first load for ceiling tests later. */
const FULL_LOAD_LINES = [
  "LOAD_ID:LD0000045821|ORIG_CITY:Atlanta                       |ORIG_STATE:GA|ORIG_ZIP:30303|DEST_CITY:Dallas                        |DEST_STATE:TX|DEST_ZIP:75201|PICKUP_DT:20270312080000|DELIVERY_DT:20270313170000|EQTYPE:DRY_VAN   |RATE:0002150|WEIGHT:0042000|COMMODITY:PALLETIZED CONSUMER GOODS       |PIECES:000026|MILES:000785|DIMS:48X40 STD GMA PALLETS              |NOTES:Drop trailer at destination. Appt required.                                                                       |STATUS:OPEN    |MAX_BUY:0001950",
  "LOAD_ID:LD0000045903|ORIG_CITY:Atlanta                       |ORIG_STATE:GA|ORIG_ZIP:30303|DEST_CITY:Houston                       |DEST_STATE:TX|DEST_ZIP:77002|PICKUP_DT:20270313140000|DELIVERY_DT:20270314120000|EQTYPE:DRY_VAN   |RATE:0002280|WEIGHT:0041000|COMMODITY:GENERAL FREIGHT                 |PIECES:000024|MILES:000789|DIMS:48X40 PALLETS                      |NOTES:No lumper.                                                                                                          |STATUS:OPEN    |MAX_BUY:0002100",
  "LOAD_ID:LD0000046112|ORIG_CITY:Miami                         |ORIG_STATE:FL|ORIG_ZIP:33101|DEST_CITY:Newark                        |DEST_STATE:NJ|DEST_ZIP:07102|PICKUP_DT:20270314063000|DELIVERY_DT:20270316120000|EQTYPE:REEFER    |RATE:0003420|WEIGHT:0038500|COMMODITY:FRESH PRODUCE - MIXED           |PIECES:000022|MILES:001280|DIMS:48X40 CHEP PALLETS                 |NOTES:Reefer set 34F continuous.                                                                                          |STATUS:OPEN    |MAX_BUY:0003200",
  "LOAD_ID:LD0000046999|ORIG_CITY:Birmingham                    |ORIG_STATE:AL|ORIG_ZIP:35203|DEST_CITY:Kansas City                   |DEST_STATE:MO|DEST_ZIP:64106|PICKUP_DT:20200101080000|DELIVERY_DT:20200102170000|EQTYPE:DRY_VAN   |RATE:0001800|WEIGHT:0042000|COMMODITY:GENERAL FREIGHT                 |PIECES:000026|MILES:000612|DIMS:48X40 PALLETS                      |NOTES:Past pickup (filter test).                                                                                          |STATUS:OPEN    |MAX_BUY:0001700",
  "LOAD_ID:LD0000047000|ORIG_CITY:Mobile                          |ORIG_STATE:AL|ORIG_ZIP:36602|DEST_CITY:Memphis                       |DEST_STATE:TN|DEST_ZIP:38103|PICKUP_DT:20270315090000|DELIVERY_DT:20270316180000|EQTYPE:DRY_VAN   |RATE:0001900|WEIGHT:0040000|COMMODITY:GENERAL FREIGHT                 |PIECES:000020|MILES:000390|DIMS:48X40 PALLETS                      |NOTES:Already booked.                                                                                                     |STATUS:BOOKED  |MAX_BUY:0001800",
] as const;

export type FakeLoadRecord = Map<string, string>;

export function defaultFakeLoads(): FakeLoadRecord[] {
  return FULL_LOAD_LINES.map((line) => parseRecordLine(line));
}

/** QUERY summary line (subset of fields). */
export function toQueryLine(record: FakeLoadRecord): string {
  return TMS_QUERY_SUMMARY_FIELDS.map((k) => `${k}:${record.get(k) ?? ""}`).join(
    "|",
  );
}

export function toFullLine(record: FakeLoadRecord): string {
  const parts: string[] = [];
  for (const key of TMS_FULL_LOAD_FIELD_ORDER) {
    const value = record.get(key);
    if (value !== undefined) {
      parts.push(`${key}:${value}`);
    }
  }
  return parts.join("|");
}
