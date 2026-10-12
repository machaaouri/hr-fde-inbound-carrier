import {
  MAX_RESENDS,
  MAX_VERIFY_ATTEMPTS,
  OTP_TTL_MS,
} from "./constants.ts";
import { codesMatch, hashOtpCode, randomSalt } from "./crypto.ts";
import { generateOtpCode } from "./generate-code.ts";
import { maskEmail } from "./mask-email.ts";
import type {
  SendOtpInput,
  SendOtpOutput,
  SendOtpError,
  VerifyOtpInput,
  VerifyOtpOutput,
} from "./types.ts";

export function sendOtp(input: SendOtpInput): SendOtpOutput | SendOtpError {
  const email = input.email.trim();
  if (!email.includes("@")) {
    return { code: "VALIDATION", message: "email is invalid" };
  }

  const isResend = input.is_resend === true;
  if (isResend && input.resends >= MAX_RESENDS) {
    return { code: "RESEND_LIMIT", message: "maximum OTP resends reached" };
  }

  const otp_code = generateOtpCode();
  const salt = randomSalt();
  const code_hash = hashOtpCode(salt, otp_code);
  const expires_at = new Date(Date.now() + OTP_TTL_MS).toISOString();
  const resends = isResend ? input.resends + 1 : input.resends;

  return {
    sent: true,
    masked_destination: maskEmail(email),
    otp_code,
    code_hash,
    salt,
    expires_at,
    resends,
    status: "pending",
  };
}

function normalizeCode(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) {
    return null;
  }
  return digits;
}

export function verifyOtp(input: VerifyOtpInput): VerifyOtpOutput {
  if (input.attempts >= MAX_VERIFY_ATTEMPTS) {
    return {
      result: "locked_out",
      attempts: input.attempts,
      attempts_left: 0,
    };
  }

  const expiresMs = Date.parse(input.expires_at);
  if (Number.isNaN(expiresMs) || Date.now() > expiresMs) {
    return {
      result: "expired",
      attempts: input.attempts,
      attempts_left: Math.max(0, MAX_VERIFY_ATTEMPTS - input.attempts),
    };
  }

  const code = normalizeCode(input.code);
  if (!code) {
    const attempts = input.attempts + 1;
    return failedOrLocked(attempts);
  }

  if (codesMatch(input.code_hash, input.salt, code)) {
    return {
      result: "passed",
      attempts: input.attempts,
      attempts_left: MAX_VERIFY_ATTEMPTS - input.attempts,
    };
  }

  const attempts = input.attempts + 1;
  return failedOrLocked(attempts);
}

function failedOrLocked(attempts: number): VerifyOtpOutput {
  if (attempts >= MAX_VERIFY_ATTEMPTS) {
    return {
      result: "locked_out",
      attempts,
      attempts_left: 0,
    };
  }
  return {
    result: "failed",
    attempts,
    attempts_left: MAX_VERIFY_ATTEMPTS - attempts,
  };
}
