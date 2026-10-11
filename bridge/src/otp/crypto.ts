import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

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
