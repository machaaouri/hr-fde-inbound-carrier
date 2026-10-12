import { describe, expect, it } from "vitest";
import { hashOtpCode } from "../src/otp/crypto.ts";
import { maskEmail } from "../src/otp/mask-email.ts";
import { sendOtp, verifyOtp } from "../src/otp/service.ts";
import { MAX_RESENDS, MAX_VERIFY_ATTEMPTS } from "../src/otp/constants.ts";

describe("maskEmail", () => {
  it("masks local part", () => {
    expect(maskEmail("carrier@example.com")).toBe("c***@example.com");
  });
});

describe("sendOtp", () => {
  it("returns hash and code without storing state", () => {
    const out = sendOtp({
      run_id: "run-1",
      mc_number: "MC-1",
      email: "carrier@example.com",
      resends: 0,
    });
    expect(out).not.toHaveProperty("code");
    if ("code" in out) throw new Error("unexpected error");
    expect(out.sent).toBe(true);
    expect(out.otp_code).toMatch(/^\d{6}$/);
    expect(out.code_hash).toBe(hashOtpCode(out.salt, out.otp_code));
  });

  it("blocks resend when limit reached", () => {
    const out = sendOtp({
      run_id: "run-1",
      mc_number: "MC-1",
      email: "carrier@example.com",
      resends: MAX_RESENDS,
      is_resend: true,
    });
    expect(out).toEqual({
      code: "RESEND_LIMIT",
      message: "maximum OTP resends reached",
    });
  });
});

describe("verifyOtp", () => {
  it("passes on matching code", () => {
    const sent = sendOtp({
      run_id: "run-1",
      mc_number: "MC-1",
      email: "a@b.com",
      resends: 0,
    });
    if ("code" in sent) throw new Error("send failed");

    const out = verifyOtp({
      run_id: "run-1",
      code: sent.otp_code,
      code_hash: sent.code_hash,
      salt: sent.salt,
      expires_at: sent.expires_at,
      attempts: 0,
    });
    expect(out.result).toBe("passed");
    expect(Object.keys(out).sort()).toEqual(["attempts", "attempts_left", "result"]);
  });

  it("increments attempts on wrong code", () => {
    const sent = sendOtp({
      run_id: "run-1",
      mc_number: "MC-1",
      email: "a@b.com",
      resends: 0,
    });
    if ("code" in sent) throw new Error("send failed");

    const out = verifyOtp({
      run_id: "run-1",
      code: "000000",
      code_hash: sent.code_hash,
      salt: sent.salt,
      expires_at: sent.expires_at,
      attempts: 0,
    });
    expect(out.result).toBe("failed");
    expect(out.attempts).toBe(1);
    expect(out.attempts_left).toBe(MAX_VERIFY_ATTEMPTS - 1);
  });

  it("locks out after max attempts", () => {
    const sent = sendOtp({
      run_id: "run-1",
      mc_number: "MC-1",
      email: "a@b.com",
      resends: 0,
    });
    if ("code" in sent) throw new Error("send failed");

    const out = verifyOtp({
      run_id: "run-1",
      code: "bad",
      code_hash: sent.code_hash,
      salt: sent.salt,
      expires_at: sent.expires_at,
      attempts: MAX_VERIFY_ATTEMPTS - 1,
    });
    expect(out.result).toBe("locked_out");
  });
});
