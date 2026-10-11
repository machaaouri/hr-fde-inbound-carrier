import { describe, expect, it } from "vitest";
import { TMS_FIELD } from "../src/tms/fields.ts";
import { parseRecordLine } from "../src/tms/parser.ts";
import {
  mapTmsRecordToSafeLoad,
  mapTmsSearchRowToSafeLoad,
} from "../src/loads/map-safe-load.ts";

describe("mapTmsRecordToSafeLoad", () => {
  it("allows missing NOTES and DIMS on live TMS rows", () => {
    const line =
      "LOAD_ID:LD1|ORIG_CITY:Birmingham|ORIG_STATE:AL|ORIG_ZIP:35203|DEST_CITY:Kansas City|DEST_STATE:MO|DEST_ZIP:64106|PICKUP_DT:20270312080000|DELIVERY_DT:20270313170000|EQTYPE:DRY_VAN|RATE:0001800|WEIGHT:0042000|COMMODITY:GENERAL FREIGHT|PIECES:000026|MILES:000612|STATUS:OPEN";
    expect(mapTmsRecordToSafeLoad(parseRecordLine(line)).loadboard_rate).toBe(1800);
    const record = parseRecordLine(line);
    const safe = mapTmsRecordToSafeLoad(record);
    expect(safe.notes).toBe("");
    expect(safe.dimensions).toBe("");
    expect(safe.id).toBe("LD1");
    expect(record.has(TMS_FIELD.NOTES)).toBe(false);
  });

  it("maps LOAD_QUERY summary rows without DELIVERY_DT or cargo fields", () => {
    const line =
      "LOAD_ID:LD0000045821|ORIG_CITY:Atlanta|ORIG_STATE:GA|ORIG_ZIP:30303|DEST_CITY:Dallas|DEST_STATE:TX|DEST_ZIP:75201|PICKUP_DT:20270312080000|EQTYPE:DRY_VAN|RATE:0002150|MILES:000785|STATUS:OPEN";
    const safe = mapTmsSearchRowToSafeLoad(parseRecordLine(line));
    expect(safe.id).toBe("LD0000045821");
    expect(safe.loadboard_rate).toBe(2150);
    expect(safe.delivery_at).toBe("");
    expect(safe.weight).toBe(0);
    expect(safe.commodity).toBe("");
  });
});
