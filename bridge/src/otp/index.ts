export {
  MAX_RESENDS,
  MAX_VERIFY_ATTEMPTS,
  OTP_LENGTH,
  OTP_TTL_MS,
} from "./constants.ts";
export { sendOtp, verifyOtp } from "./service.ts";
export type {
  OtpChallengeStatus,
  SendOtpError,
  SendOtpErrorCode,
  SendOtpInput,
  SendOtpOutput,
  SendOtpResult,
  VerifyOtpInput,
  VerifyOtpOutput,
  VerifyOtpResult,
} from "./types.ts";
export { maskEmail } from "./mask-email.ts";
