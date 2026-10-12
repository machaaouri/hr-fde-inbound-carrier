import type { BridgeConfig } from "../config/types.ts";
import type { TmsClient } from "../tms/client.ts";
import { buildBookingWorkflowResponse } from "./booking-response.ts";
import type { BookingWorkflowRequest, BookingWorkflowResponse } from "./booking-types.ts";
import { executeBookingOnTms } from "./create-booking-service.ts";

function gateNotReady(req: BookingWorkflowRequest): boolean {
  if (req.otp_challenge_status !== "passed") {
    return true;
  }
  if (req.agreed_rate === null) {
    return true;
  }
  return false;
}

export async function bookingForWorkflow(
  client: TmsClient,
  config: BridgeConfig,
  req: BookingWorkflowRequest,
): Promise<BookingWorkflowResponse> {
  if (gateNotReady(req)) {
    return buildBookingWorkflowResponse("NOT_READY");
  }

  const result = await executeBookingOnTms(
    client,
    config.tmsToken,
    req.load_id,
    req.mc_number,
    req.agreed_rate!,
  );

  return buildBookingWorkflowResponse(result.status, result.booking_ref);
}
