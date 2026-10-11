import { z } from "zod";

export const verifyCarrierBody = z.object({
  mc_number: z.string().min(1),
});

export const sendOtpBody = z.object({
  run_id: z.string().min(1),
  mc_number: z.string().min(1),
  email: z.string().email(),
  resends: z.number().int().min(0),
  is_resend: z.boolean().optional(),
});

export const verifyOtpBody = z.object({
  run_id: z.string().min(1),
  code: z.string().min(1),
  code_hash: z.string().min(1),
  salt: z.string().min(1),
  expires_at: z.string().min(1),
  attempts: z.number().int().min(0),
});
