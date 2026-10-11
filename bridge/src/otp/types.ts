export type SendOtpInput = {
  run_id: string;
  mc_number: string;
  email: string;
  resends: number;
  is_resend?: boolean;
};

export type OtpChallengeStatus = "pending";

export type SendOtpOutput = {
  sent: true;
  masked_destination: string;
  otp_code: string;
  code_hash: string;
  salt: string;
  expires_at: string;
  resends: number;
  status: OtpChallengeStatus;
};

export type SendOtpErrorCode = "RESEND_LIMIT" | "VALIDATION";

export type SendOtpError = {
  code: SendOtpErrorCode;
  message: string;
};

export type SendOtpResult = SendOtpOutput | SendOtpError;

export type VerifyOtpInput = {
  run_id: string;
  code: string;
  code_hash: string;
  salt: string;
  expires_at: string;
  attempts: number;
};

export type VerifyOtpResult = "passed" | "failed" | "expired" | "locked_out";

export type VerifyOtpOutput = {
  result: VerifyOtpResult;
  attempts: number;
  attempts_left: number;
  mc_locked: boolean;
};
