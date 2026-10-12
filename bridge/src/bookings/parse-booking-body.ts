import { z } from "zod";
import {
  normalizeChallengeStatus,
  parseTwinDollarField,
} from "../twin/workflow-fields.ts";
import type { BookingWorkflowRequest } from "./booking-types.ts";

const bookingWorkflowBodySchema = z.object({
  load_id: z.string().min(1),
  mc_number: z.string().min(1),
  agreed_rate: z.union([z.number(), z.string(), z.null()]).optional(),
  run_id: z.string().min(1),
  otp_challenge_status: z.union([z.string(), z.null()]).optional(),
});

export function parseBookingWorkflowInput(body: unknown): BookingWorkflowRequest {
  const parsed = bookingWorkflowBodySchema.parse(body);

  return {
    load_id: parsed.load_id.trim(),
    mc_number: parsed.mc_number.trim(),
    agreed_rate: parseTwinDollarField(parsed.agreed_rate),
    run_id: parsed.run_id.trim(),
    otp_challenge_status: normalizeChallengeStatus(parsed.otp_challenge_status),
  };
}
