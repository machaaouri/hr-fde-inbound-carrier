/**
 * Contract-shaped stub payloads (step 2). No ceiling or loadboard_rate fields.
 * Replaced by real integrations in steps 3–6.
 */

export function stubVerifyCarrier() {
  return {
    eligible: true,
    carrier_name: "Stub Carrier LLC",
    dot_number: "0000000",
    reason: "ACTIVE" as const,
  };
}

export function stubSearchLoads() {
  return {
    loads: [
      {
        id: "LD-STUB-001",
        origin: { city: "Birmingham", state: "AL", zip: "35203" },
        destination: { city: "Kansas City", state: "MO", zip: "64106" },
        pickup_at: "2026-05-12T08:00:00.000Z",
        delivery_at: "2026-05-13T17:00:00.000Z",
        equipment_type: "DRY_VAN",
        miles: 612,
        weight: 42000,
        commodity: "GENERAL FREIGHT",
        pieces: 26,
        dimensions: "48X40 PALLETS",
        notes: "Stub load for workflow wiring (step 2).",
      },
    ],
  };
}

export function stubDecideOffer(round: number) {
  return {
    decision: round === 0 ? ("OPENING" as const) : ("COUNTER" as const),
    broker_offer: 1800,
    rounds_remaining: Math.max(0, 3 - round),
  };
}

export function stubBooking() {
  return {
    status: "BOOKED" as const,
    booking_ref: "STUB-REF-001",
  };
}

export function stubSendOtp(email: string) {
  return {
    sent: true,
    masked_destination: email.replace(/^(.).*@/, "$1***@"),
    otp_code: "000000",
    code_hash: "stub-hash-not-valid",
    salt: "stub-salt",
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    resends: 0,
    status: "pending" as const,
  };
}

export function stubVerifyOtp() {
  return {
    result: "passed" as const,
    attempts: 0,
    attempts_left: 3,
    mc_locked: true,
  };
}
