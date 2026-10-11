import { sendOtp, verifyOtp } from "../otp/service.ts";
import type { SendOtpError } from "../otp/types.ts";
import { BridgeError, validationError } from "./errors.ts";
import type { sendOtpBody, verifyOtpBody } from "./schemas.ts";
import type { z } from "zod";

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
