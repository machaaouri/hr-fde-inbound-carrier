/** Round down to a whole-dollar step (e.g. 5 or 25). */
export function roundDownToStep(dollars: number, step: number): number {
  if (!Number.isFinite(dollars) || !Number.isFinite(step) || step <= 0) {
    throw new Error("roundDownToStep: invalid amount or step");
  }
  return Math.floor(dollars / step) * step;
}

/** Whole USD, rounded down to $25 (D2). */
export function floor25(dollars: number): number {
  return roundDownToStep(dollars, 25);
}

/** $5 steps on smaller loads; $25 otherwise. */
export function counterStepSize(previousBrokerOffer: number): number {
  return previousBrokerOffer < 1000 ? 5 : 25;
}
