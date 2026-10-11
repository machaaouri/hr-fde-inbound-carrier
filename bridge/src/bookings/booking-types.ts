/** Values on `agent.status` (workflow reads decision from here, always HTTP 200). */
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
  otp_status: string;
  outcome: string;
};

export type BookingWorkflowResponse = {
  agent: {
    status: AgentBookingStatus;
    booking_ref: string | null;
  };
  calls: {
    booking_ref: string | null;
    outcome: string;
  };
};

export type BookingExecutionResult = {
  status: AgentBookingStatus;
  booking_ref?: string;
};
