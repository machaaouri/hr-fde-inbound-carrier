export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "LOAD_NOT_FOUND"
  | "LOAD_UNAVAILABLE"
  | "RATE_NOT_ACCEPTABLE"
  | "CEILING_UNAVAILABLE"
  | "TMS_UNAVAILABLE"
  | "TMS_BAD_RESPONSE"
  | "FMCSA_UNAVAILABLE"
  | "FMCSA_MISCONFIGURED"
  | "INTERNAL";

export type ErrorEnvelope = {
  error: {
    code: ApiErrorCode;
    message: string;
    retryable: boolean;
    request_id: string;
  };
};

export type RouteOutcomeSnapshot = {
  endpoint: string;
  decision?: string;
  status?: string;
  error_code?: ApiErrorCode | string;
};

export type RequestContext = {
  requestId: string;
  hrRunId?: string;
  startedAtMs: number;
  tmsMs: number;
  routeOutcome?: RouteOutcomeSnapshot;
};


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
