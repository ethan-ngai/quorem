/** @file long.ts @description Exact signed 64-bit decimal wire values. @module contracts */
export function isLongValue(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?:0|-?[1-9]\d{0,18})$/.test(value)) return false;
  const integer = BigInt(value);
  return integer.toString() === value && integer >= -(1n << 63n) && integer < 1n << 63n;
}

/** Compare mixed integer and floating point projections without rounding the integer. */
export function compareNumericValues(a: number | bigint, b: number | bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
