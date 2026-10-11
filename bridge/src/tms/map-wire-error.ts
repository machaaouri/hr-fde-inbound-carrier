import { BridgeError } from "../http/errors.ts";

export function bridgeErrorFromTmsWire(code: string, message: string): BridgeError {
  switch (code) {
    case "UNKNOWN_LOAD":
      return new BridgeError("LOAD_NOT_FOUND", message, 404);
    case "AUTH_FAILED":
      return new BridgeError("TMS_UNAVAILABLE", "TMS authentication failed", 503, true);
    case "SERVER_ERROR":
      return new BridgeError("TMS_UNAVAILABLE", message, 503, true);
    case "MALFORMED":
      return new BridgeError("TMS_BAD_RESPONSE", message, 502);
    default:
      return new BridgeError("TMS_UNAVAILABLE", message, 503, true);
  }
}
