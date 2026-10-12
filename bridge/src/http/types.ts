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
