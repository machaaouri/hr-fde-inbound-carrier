/** Whole USD, rounded down to $25 (D2). */
export function floor25(dollars: number): number {
  if (!Number.isFinite(dollars)) {
    throw new Error("floor25: non-finite amount");
  }
  return Math.floor(dollars / 25) * 25;
}
