import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** OTP policy — see docs/design.md (OTP). */
export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const MAX_VERIFY_ATTEMPTS = 3;
export const MAX_RESENDS = 2;


export function randomSalt(): string {
  return randomBytes(16).toString("hex");
}

export function hashOtpCode(salt: string, code: string): string {
  return createHash("sha256").update(`${salt}:${code}`, "utf8").digest("hex");
}

export function codesMatch(expectedHash: string, salt: string, code: string): boolean {
  const actual = hashOtpCode(salt, code);
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expectedHash, "hex");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}


/** Cryptographic 6-digit string, leading zeros allowed. */
export function generateOtpCode(): string {
  const max = 10 ** OTP_LENGTH;
  const n = randomInt(0, max);
  return n.toString().padStart(OTP_LENGTH, "0");
}


/** Agent-safe hint, e.g. `j***@example.com`. */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) {
    return "***";
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}
