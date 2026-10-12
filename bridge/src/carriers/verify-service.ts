import type { BridgeConfig } from "../config/config.ts";
import { validationError } from "../http/errors.ts";
import {
  evaluateCarrierEligibility,
  normalizeMcDocket,
  notFoundResult,
} from "../fmcsa/eligibility.ts";
import { FmcsaClient } from "../fmcsa/client.ts";
import type { VerifyCarrierResult } from "../fmcsa/types.ts";

export async function verifyCarrierByMc(
  client: FmcsaClient,
  mcNumberRaw: string,
): Promise<VerifyCarrierResult> {
  const docket = normalizeMcDocket(mcNumberRaw);
  if (docket === null) {
    throw validationError("mc_number must contain a valid MC docket (digits)");
  }

  const lookup = await client.lookupByMcDocket(docket);
  if (lookup === null) {
    return notFoundResult();
  }

  return evaluateCarrierEligibility(lookup.carrier, lookup.authorityRows);
}

export async function verifyCarrierFromConfig(
  config: BridgeConfig,
  mcNumber: string,
  client?: FmcsaClient,
): Promise<VerifyCarrierResult> {
  const fmcsa = client ?? FmcsaClient.fromConfig(config);
  return verifyCarrierByMc(fmcsa, mcNumber);
}
