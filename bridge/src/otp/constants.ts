/** OTP policy — keep in sync with docs/decisions.md D8. */
export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const MAX_VERIFY_ATTEMPTS = 3;
export const MAX_RESENDS = 2;
