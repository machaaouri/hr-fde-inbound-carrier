import { z } from "zod";
import { validationError } from "../http/errors.ts";
import type { CarrierCounterParse } from "./parse-carrier-counter.ts";
import type { DecideWorkflowRequest } from "./decide-types.ts";

const optionalDollarRaw = z.union([z.number(), z.string(), z.null()]).optional();

const decideWorkflowBodySchema = z.object({
  action: z.enum(["negotiate", "accept"]),
  load_id: z.string().min(1),
  carrier_counter: z.union([z.string(), z.null()]).optional(),
  otp_status: z.union([z.string(), z.null()]).optional(),
  current_load_id: z.union([z.string(), z.null()]).optional(),
  rounds_used: z.union([z.coerce.number().int().min(0), z.null()]).optional(),
  standing_offer: optionalDollarRaw,
  agreed_rate: optionalDollarRaw,
  outcome: z.union([z.string(), z.null()]).optional(),
});

/**
 * Twin nullable fields → whole dollars or null (not provided).
 * Does not throw on bad strings — returns null for unparsable (accept uses NO_OFFER).
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

export function parseDecideWorkflowInput(body: unknown): DecideWorkflowRequest {
  const parsed = decideWorkflowBodySchema.parse(body);

  const rounds_used = parsed.rounds_used ?? 0;
  if (rounds_used > 3) {
    throw validationError("rounds_used must be between 0 and 3");
  }

  const outcomeRaw = parsed.outcome?.trim() ?? "";
  const outcome = outcomeRaw === "" ? "abandoned" : outcomeRaw;

  return {
    action: parsed.action,
    load_id: parsed.load_id.trim(),
    carrier_counter:
      parsed.carrier_counter === null || parsed.carrier_counter === undefined
        ? ""
        : String(parsed.carrier_counter),
    otp_status: parsed.otp_status?.trim() ?? "",
    current_load_id: parsed.current_load_id?.trim() ?? "",
    rounds_used,
    standing_offer: parseTwinDollarField(parsed.standing_offer),
    agreed_rate: parseTwinDollarField(parsed.agreed_rate),
    outcome,
  };
}

/** Policy round index for logging (0 = opening, 1..3 = counter rounds). */
export function decideLogRound(
  req: DecideWorkflowRequest,
  counter: CarrierCounterParse,
): number {
  if (req.action === "accept") {
    return req.rounds_used;
  }
  if (counter.kind === "empty") {
    return 0;
  }
  const sameLoad =
    req.load_id !== "" &&
    req.current_load_id !== "" &&
    req.load_id === req.current_load_id;
  const base = sameLoad ? req.rounds_used : 0;
  return base + 1;
}
