import { z } from "zod";
import { sendOtp, verifyOtp } from "../otp/service.ts";
import type { SendOtpError } from "../otp/types.ts";
import { BridgeError, validationError } from "../http/errors.ts";

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


export function handleSendOtp(body: z.infer<typeof sendOtpBody>) {
  const out = sendOtp({
    run_id: body.run_id,
    mc_number: body.mc_number,
    email: body.email,
    resends: body.resends,
    is_resend: body.is_resend,
  });
  if (isSendOtpError(out)) {
    if (out.code === "RESEND_LIMIT") {
      throw new BridgeError("VALIDATION_ERROR", out.message, 422);
    }
    throw validationError(out.message);
  }
  return out;
}

export function handleVerifyOtp(body: z.infer<typeof verifyOtpBody>) {
  return verifyOtp({
    run_id: body.run_id,
    code: body.code,
    code_hash: body.code_hash,
    salt: body.salt,
    expires_at: body.expires_at,
    attempts: body.attempts,
  });
}

function isSendOtpError(
  out: ReturnType<typeof sendOtp>,
): out is SendOtpError {
  return "code" in out;
}

