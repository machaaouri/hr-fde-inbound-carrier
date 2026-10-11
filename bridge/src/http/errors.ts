import type { ApiErrorCode, ErrorEnvelope } from "./types.ts";

export class BridgeError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly retryable: boolean;

  constructor(
    code: ApiErrorCode,
    message: string,
    statusCode: number,
    retryable = false,
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

export function toErrorEnvelope(
  err: BridgeError,
  requestId: string,
): ErrorEnvelope {
  return {
    error: {
      code: err.code,
      message: err.message,
      retryable: err.retryable,
      request_id: requestId,
    },
  };
}

export function validationError(message: string): BridgeError {
  return new BridgeError("VALIDATION_ERROR", message, 422);
}

export function unauthorizedError(): BridgeError {
  return new BridgeError("UNAUTHORIZED", "Invalid or missing bearer token", 401);
}
