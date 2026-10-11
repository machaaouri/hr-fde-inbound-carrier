import { randomInt } from "node:crypto";
import { OTP_LENGTH } from "./constants.ts";

/** Cryptographic 6-digit string, leading zeros allowed. */
export function generateOtpCode(): string {
  const max = 10 ** OTP_LENGTH;
  const n = randomInt(0, max);
  return n.toString().padStart(OTP_LENGTH, "0");
}
