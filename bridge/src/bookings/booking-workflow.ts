import { z } from "zod";
import type { BridgeConfig } from "../config/config.ts";
import {
  normalizeChallengeStatus,
  parseTwinDollarField,
} from "../http/request-parsing.ts";
import type { TmsClient } from "../tms/client.ts";
import { executeBookingOnTms } from "./create-booking-service.ts";

export type AgentBookingStatus =
  | "NOT_READY"
  | "RATE_NOT_ACCEPTABLE"
  | "LOAD_UNAVAILABLE"
  | "NOT_BOOKED"
  | "BOOKED"
  | "BOOKED_RECONCILED";

export type BookingWorkflowRequest = {
  load_id: string;
  mc_number: string;
  agreed_rate: number | null;
  run_id: string;
  otp_challenge_status: string;
};

export type BookingCallsPatch = {
  booking_ref?: string;
  outcome?: string;
};

export type BookingWorkflowResponse = {
  agent: {
    status: AgentBookingStatus;
    booking_ref: string | null;
  };
  calls: BookingCallsPatch;
};

export type BookingExecutionResult = {
  status: AgentBookingStatus;
  booking_ref?: string;
};

const bookingWorkflowBodySchema = z.object({
  load_id: z.string().min(1),
  mc_number: z.string().min(1),
  agreed_rate: z.union([z.number(), z.string(), z.null()]).optional(),
  run_id: z.string().min(1),
  otp_challenge_status: z.union([z.string(), z.null()]).optional(),
});

export function parseBookingWorkflowInput(body: unknown): BookingWorkflowRequest {
  const parsed = bookingWorkflowBodySchema.parse(body);
  return {
    load_id: parsed.load_id.trim(),
    mc_number: parsed.mc_number.trim(),
    agreed_rate: parseTwinDollarField(parsed.agreed_rate),
    run_id: parsed.run_id.trim(),
    otp_challenge_status: normalizeChallengeStatus(parsed.otp_challenge_status),
  };
}

export function buildBookingWorkflowResponse(
  status: AgentBookingStatus,
  bookingRef?: string,
): BookingWorkflowResponse {
  const booked = status === "BOOKED" || status === "BOOKED_RECONCILED";
  const ref = booked && bookingRef ? bookingRef : null;
  const calls: BookingCallsPatch = {};
  if (booked && ref) {
    calls.booking_ref = ref;
    calls.outcome = "booked";
  }
  return {
    agent: { status, booking_ref: ref },
    calls,
  };
}

export function assertNoSensitivePricingFields(json: string): void {
  if (/max_buy|maxbuy|ceiling|posted_rate|loadboard/i.test(json)) {
    throw new Error("response leaks internal pricing fields");
  }
}

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
