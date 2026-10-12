import { z } from "zod";
import {
  defaultOutcome,
  parseTwinDollarField,
  resolveVerificationStatus,
  verificationFieldDisagreements,
  type WorkflowInputStyle,
} from "../twin/workflow-fields.ts";
import type { BookingWorkflowRequest } from "./booking-types.ts";

const bookingWorkflowBodySchema = z.object({
  load_id: z.string().min(1),
  mc_number: z.string().min(1),
  agreed_rate: z.union([z.number(), z.string(), z.null()]).optional(),
  run_id: z.string().min(1),
  otp_status: z.union([z.string(), z.null()]).optional(),
  otp_challenge_status: z.union([z.string(), z.null()]).optional(),
  outcome: z.union([z.string(), z.null()]).optional(),
});

export type ParsedBookingWorkflow = BookingWorkflowRequest & {
  inputStyle: WorkflowInputStyle;
  precedenceWarnings: string[];
};

export function parseBookingWorkflowInput(body: unknown): ParsedBookingWorkflow {
  const parsed = bookingWorkflowBodySchema.parse(body);
  const legacyOtp = parsed.otp_status?.trim() ?? "";
  const verification = resolveVerificationStatus(
    parsed.otp_status,
    parsed.otp_challenge_status,
  );
  const precedenceWarnings = verification.usedChallengeStatus
    ? verificationFieldDisagreements(
        legacyOtp,
        verification.otp_status,
        true,
      )
    : [];

  const inputStyle: WorkflowInputStyle = verification.usedChallengeStatus
    ? "source"
    : "legacy";

  return {
    load_id: parsed.load_id.trim(),
    mc_number: parsed.mc_number.trim(),
    agreed_rate: parseTwinDollarField(parsed.agreed_rate),
    run_id: parsed.run_id.trim(),
    otp_status: verification.otp_status,
    outcome: defaultOutcome(parsed.outcome),
    inputStyle,
    precedenceWarnings,
  };
}
