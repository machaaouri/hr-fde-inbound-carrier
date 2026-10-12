import type {
  AgentBookingStatus,
  BookingCallsPatch,
  BookingWorkflowResponse,
} from "./booking-types.ts";

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
    agent: {
      status,
      booking_ref: ref,
    },
    calls,
  };
}

/** Guard for tests — responses must never leak ceiling fields. */
export function assertNoSensitivePricingFields(json: string): void {
  if (/max_buy|maxbuy|ceiling|posted_rate|loadboard/i.test(json)) {
    throw new Error("response leaks internal pricing fields");
  }
}
