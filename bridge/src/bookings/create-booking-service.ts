import { BridgeError } from "../http/errors.ts";
import { normalizeMcDocket } from "../fmcsa/normalize-mc.ts";
import { fetchLoadPricing } from "../offers/load-pricing.ts";
import { tmsTrim } from "../loads/tms-record.ts";
import { TMS_FIELD, TMS_LOAD_STATUS } from "../tms/fields.ts";
import type { TmsClient } from "../tms/client.ts";
import { fetchLoadRecord } from "../tms/fetch-load-record.ts";
import type { BookingExecutionResult } from "./booking-workflow.ts";
import { submitLoadBookWire } from "./submit-load-book.ts";

export async function executeBookingOnTms(
  client: TmsClient,
  tmsToken: string,
  loadId: string,
  mcNumber: string,
  agreedRate: number,
): Promise<BookingExecutionResult> {
  const mcDigits = normalizeMcDocket(mcNumber);
  if (mcDigits === null) {
    return { status: "NOT_READY" };
  }

  const pricing = await fetchLoadPricing(client, tmsToken, loadId);
  // TMS says STATUS ≠ OPEN (usually already BOOKED). Maybe our prior book — reconcile only.
  if (!pricing.loadAvailable) {
    const reconciled = await reconcileBookingState(client, tmsToken, loadId);
    if (reconciled.status === "NOT_BOOKED" || reconciled.status === "LOAD_UNAVAILABLE") {
      return { status: "LOAD_UNAVAILABLE" };
    }
    return reconciled;
  }

  if (agreedRate > pricing.maxBuy) {
    return { status: "RATE_NOT_ACCEPTABLE" };
  }

  try {
    const wire = await submitLoadBookWire(
      client,
      tmsToken,
      loadId,
      mcDigits,
      agreedRate,
    );

    if (wire.kind === "booked") {
      return { status: "BOOKED", booking_ref: wire.booking_ref };
    }

    return reconcileBookingState(client, tmsToken, loadId);
  } catch (err) {
    if (err instanceof BridgeError && err.retryable) {
      const reconciled = await reconcileBookingState(client, tmsToken, loadId);
      if (reconciled.status === "BOOKED" || reconciled.status === "BOOKED_RECONCILED") {
        return reconciled;
      }
      if (reconciled.status === "NOT_BOOKED") {
        return { status: "NOT_BOOKED" };
      }
      return { status: "LOAD_UNAVAILABLE" };
    }
    throw err;
  }
}

/** After LOAD_BOOK uncertainty or duplicate book: LOAD_GET to see if the load is ours. */
async function reconcileBookingState(
  client: TmsClient,
  tmsToken: string,
  loadId: string,
): Promise<BookingExecutionResult> {
  let record;
  try {
    record = await fetchLoadRecord(client, tmsToken, loadId, "LOAD_GET_RECONCILE");
  } catch (err) {
    if (err instanceof BridgeError && err.code === "LOAD_NOT_FOUND") {
      return { status: "LOAD_UNAVAILABLE" };
    }
    throw err;
  }

  const status = tmsTrim(record.get(TMS_FIELD.STATUS) ?? "");
  // Booking did not stick (e.g. timeout then GET still OPEN).
  if (status === TMS_LOAD_STATUS.OPEN) {
    return { status: "NOT_BOOKED" };
  }

  const ref = tmsTrim(record.get(TMS_FIELD.BOOKING_REF) ?? "");
  if (
    status === TMS_LOAD_STATUS.BOOKED ||
    (status === TMS_LOAD_STATUS.PENDING && ref !== "")
  ) {
    if (ref === "") {
      return { status: "LOAD_UNAVAILABLE" };
    }
    return { status: "BOOKED_RECONCILED", booking_ref: ref };
  }

  return { status: "LOAD_UNAVAILABLE" };
}
