import { validationError } from "../http/errors.ts";
import type { NormalizedSearchLoads, SearchLoadsRequestBody } from "./types.ts";

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
