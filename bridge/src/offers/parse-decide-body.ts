import { z } from "zod";
import { validationError } from "../http/errors.ts";
import {
  defaultOutcome,
  deriveNegotiationFromHistory,
  negotiationFieldDisagreements,
  parseOffersHistoryRaw,
  parseTwinDollarField,
  resolveVerificationStatus,
  verificationFieldDisagreements,
  type WorkflowInputStyle,
} from "../twin/workflow-fields.ts";
import type { CarrierCounterParse } from "./parse-carrier-counter.ts";
import type { DecideWorkflowRequest } from "./decide-types.ts";

export { parseTwinDollarField } from "../twin/workflow-fields.ts";

const optionalDollarRaw = z.union([z.number(), z.string(), z.null()]).optional();

const decideWorkflowBodySchema = z.object({
  action: z.enum(["negotiate", "accept"]),
  load_id: z.string().min(1),
  carrier_counter: z.union([z.string(), z.null()]).optional(),
  otp_status: z.union([z.string(), z.null()]).optional(),
  otp_challenge_status: z.union([z.string(), z.null()]).optional(),
  current_load_id: z.union([z.string(), z.null()]).optional(),
  rounds_used: z.union([z.coerce.number().int().min(0), z.null()]).optional(),
  standing_offer: optionalDollarRaw,
  agreed_rate: optionalDollarRaw,
  outcome: z.union([z.string(), z.null()]).optional(),
  offers_history: z.union([z.array(z.unknown()), z.string(), z.null()]).optional(),
});

export type ParsedDecideWorkflow = DecideWorkflowRequest & {
  inputStyle: WorkflowInputStyle;
  precedenceWarnings: string[];
};

export function parseDecideWorkflowInput(body: unknown): ParsedDecideWorkflow {
  const parsed = decideWorkflowBodySchema.parse(body);
  const rawBody = body as Record<string, unknown>;

  const load_id = parsed.load_id.trim();
  const legacyRounds = parsed.rounds_used ?? 0;
  if (legacyRounds > 3) {
    throw validationError("rounds_used must be between 0 and 3");
  }
  const legacyStanding = parseTwinDollarField(parsed.standing_offer);

  const offersHistoryRaw = parseOffersHistoryRaw(parsed.offers_history);
  const offersHistoryFieldPresent =
    Object.prototype.hasOwnProperty.call(rawBody, "offers_history") &&
    parsed.offers_history !== undefined;

  let rounds_used = legacyRounds;
  let standing_offer = legacyStanding;
  let latest_broker_offer: number | null = null;
  let acceptFromHistory = false;

  const precedenceWarnings: string[] = [];

  if (offersHistoryFieldPresent) {
    if (offersHistoryRaw === null) {
      throw validationError("offers_history must be a JSON array");
    }
    const derived = deriveNegotiationFromHistory(load_id, offersHistoryRaw);
    acceptFromHistory = true;
    rounds_used = derived.rounds_used;
    latest_broker_offer = derived.latest_broker_offer;
    if (parsed.action === "negotiate") {
      standing_offer = derived.standing_offer;
    } else {
      // Accept: Twin sends the price to accept in standing_offer; history supplies the quote to match.
      standing_offer = legacyStanding;
    }
    precedenceWarnings.push(
      ...negotiationFieldDisagreements(
        { rounds_used: legacyRounds, standing_offer: legacyStanding },
        derived,
      ),
    );
  }

  const legacyOtp = parsed.otp_status?.trim() ?? "";
  const verification = resolveVerificationStatus(
    parsed.otp_status,
    parsed.otp_challenge_status,
  );
  if (verification.usedChallengeStatus) {
    precedenceWarnings.push(
      ...verificationFieldDisagreements(
        legacyOtp,
        verification.otp_status,
        true,
      ),
    );
  }

  const inputStyle: WorkflowInputStyle =
    offersHistoryFieldPresent || verification.usedChallengeStatus
      ? "source"
      : "legacy";

  return {
    action: parsed.action,
    load_id,
    carrier_counter:
      parsed.carrier_counter === null || parsed.carrier_counter === undefined
        ? ""
        : String(parsed.carrier_counter),
    otp_status: verification.otp_status,
    current_load_id: parsed.current_load_id?.trim() ?? "",
    rounds_used,
    standing_offer,
    agreed_rate: parseTwinDollarField(parsed.agreed_rate),
    outcome: defaultOutcome(parsed.outcome),
    acceptFromHistory,
    latest_broker_offer,
    inputStyle,
    precedenceWarnings,
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
