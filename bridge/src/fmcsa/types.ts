export type FmcsaReason = "ACTIVE" | "NOT_AUTHORIZED" | "OUT_OF_SERVICE" | "NOT_FOUND";

export type VerifyCarrierResult = {
  eligible: boolean;
  carrier_name?: string;
  dot_number?: string;
  reason: FmcsaReason;
  contact_email?: string;
};

export type FmcsaCarrierRecord = {
  dotNumber: number;
  legalName: string;
  allowedToOperate?: string;
  outOfService?: string;
  emailAddress?: string;
  email?: string;
};
