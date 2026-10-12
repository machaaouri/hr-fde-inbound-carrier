import { z } from "zod";
import { validationError } from "../http/errors.ts";
import {
  deriveNegotiationFromHistory,
  normalizeChallengeStatus,
  parseOffersHistoryRaw,
} from "../http/request-parsing.ts";
import type { DecideWorkflowRequest } from "./decide-service.ts";

export type CarrierCounterParse =
  | { kind: "empty" }
  | { kind: "ok"; dollars: number }
  | { kind: "invalid" };

export function parseCarrierCounterRaw(raw: string): CarrierCounterParse {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { kind: "empty" };
  }

  let s = trimmed.replace(/\$/g, "").replace(/,/g, "").replace(/\s/g, "");
  const dot = s.indexOf(".");
  if (dot !== -1) {
    const whole = s.slice(0, dot);
    const frac = s.slice(dot + 1);
    if (!/^\d*$/.test(whole) || (frac !== "" && !/^\d*$/.test(frac))) {
      return { kind: "invalid" };
    }
    s = whole === "" ? "0" : whole;
  }

  if (!/^\d+$/.test(s)) {
    return { kind: "invalid" };
  }

  const dollars = Number.parseInt(s, 10);
  if (!Number.isSafeInteger(dollars) || dollars <= 0) {
    return { kind: "invalid" };
  }

  return { kind: "ok", dollars };
}

export { parseTwinDollarField } from "../http/request-parsing.ts";

const offerHistoryRowSchema = z.object({
  load_id: z.string(),
  round: z.union([z.number(), z.string()]),
  carrier_counter: z.union([z.number(), z.string(), z.null()]).optional(),
  broker_offer: z.union([z.number(), z.string(), z.null()]).optional(),
  decision: z.union([z.string(), z.null()]).optional(),
});

const decideWorkflowBodySchema = z
  .object({
    action: z.enum(["negotiate", "accept"]),
    load_id: z.string().min(1),
    carrier_counter: z.union([z.string(), z.null()]).optional(),
    current_load_id: z.union([z.string(), z.null()]).optional(),
    otp_challenge_status: z.union([z.string(), z.null()]).optional(),
    offers_history: z
      .union([z.array(offerHistoryRowSchema), z.string(), z.null()])
      .optional(),
  });

export function parseDecideWorkflowInput(body: unknown): DecideWorkflowRequest {
  const parsed = decideWorkflowBodySchema.parse(body);
  const load_id = parsed.load_id.trim();

  const offersRaw = parseOffersHistoryRaw(parsed.offers_history ?? []);
  if (offersRaw === null) {
    throw validationError("offers_history must be a JSON array");
  }

  const derived = deriveNegotiationFromHistory(load_id, offersRaw);
  if (derived.max_round > 3) {
    throw validationError("offers_history round must be between 0 and 3");
  }

  return {
    action: parsed.action,
    load_id,
    carrier_counter:
      parsed.carrier_counter === null || parsed.carrier_counter === undefined
        ? ""
        : String(parsed.carrier_counter),
    current_load_id: parsed.current_load_id?.trim() ?? "",
    otp_challenge_status: normalizeChallengeStatus(parsed.otp_challenge_status),
    offers_history: offersRaw,
    max_round: derived.max_round,
    latest_broker_offer: derived.latest_broker_offer,
  };
}

/** Policy round index for logging (0 = opening, 1..3 = counter rounds). */
export function decideLogRound(
  req: DecideWorkflowRequest,
  counter: CarrierCounterParse,
): number {
  if (req.action === "accept") {
    return req.max_round;
  }
  if (counter.kind === "empty") {
    return 0;
  }
  const sameLoad =
    req.load_id !== "" &&
    req.current_load_id !== "" &&
    req.load_id === req.current_load_id;
  const base = sameLoad ? req.max_round : 0;
  return base + 1;
}
