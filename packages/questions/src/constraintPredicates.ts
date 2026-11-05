import { compareNumericValues } from "@quorem/contracts/long";
import type { Constraint } from "./model.ts";

type Numeric = number | bigint;
const numeric = (value: unknown): value is Numeric =>
  typeof value === "bigint" || (typeof value === "number" && Number.isFinite(value));
const key = (value: Numeric | string) =>
  typeof value === "string"
    ? `s:${value}`
    : typeof value === "bigint" || Number.isInteger(value)
      ? `i:${BigInt(value)}`
      : `f:${value}`;

/** Test numeric bounds without rounding integer projections to floating point. */
export function rangeContains(
  range: Extract<Constraint, { kind: "range" }>,
  value: number | bigint,
): boolean {
  if (typeof value === "number" && !Number.isFinite(value)) return false;
  if (range.min !== undefined) {
    const comparison = compareNumericValues(value, range.min);
    if (comparison < 0 || (comparison === 0 && range.minInclusive === false)) return false;
  }
  if (range.max !== undefined) {
    const comparison = compareNumericValues(value, range.max);
    if (comparison > 0 || (comparison === 0 && range.maxInclusive === false)) return false;
  }
  return true;
}

export function rangeMatches(
  rule: Extract<Constraint, { kind: "range" }>,
  values: readonly unknown[],
): boolean {
  const matches = (value: unknown) => numeric(value) && rangeContains(rule, value);
  return rule.quantifier === "any" ? values.some(matches) : values.every(matches);
}

function extremes(values: readonly Numeric[]) {
  let min = values[0],
    max = values[0];
  for (const value of values) {
    if (compareNumericValues(value, min) < 0) min = value;
    if (compareNumericValues(value, max) > 0) max = value;
  }
  return { min, max };
}

/** Quantify the cross-product in linear time; scalar operands naturally broadcast. */
export function comparisonMatches(
  rule: Extract<Constraint, { kind: "comparison" }>,
  left: readonly unknown[],
  right: readonly unknown[],
): boolean {
  if (!left.every(numeric) || !right.every(numeric)) return false;
  const any = rule.quantifier === "any";
  if (!left.length || !right.length) return !any;
  const a = extremes(left),
    b = extremes(right);
  if (rule.operator === "eq") {
    if (!any)
      return (
        compareNumericValues(a.min, a.max) === 0 &&
        compareNumericValues(b.min, b.max) === 0 &&
        compareNumericValues(a.min, b.min) === 0
      );
    const found = new Set(left.map(key));
    return right.some((value) => found.has(key(value)));
  }
  const less = rule.operator === "lt" || rule.operator === "le";
  const cmp = compareNumericValues(any === less ? a.min : a.max, any === less ? b.max : b.min);
  return { le: cmp <= 0, lt: cmp < 0, ge: cmp >= 0, gt: cmp > 0 }[rule.operator];
}

export function propertyMatches(
  rule: Extract<Constraint, { kind: "property" }>,
  values: readonly unknown[],
): boolean {
  if (rule.property === "unique") {
    if (
      !values.every(
        (value): value is Numeric | string => numeric(value) || typeof value === "string",
      )
    )
      return false;
    return new Set(values.map(key)).size === values.length;
  }
  if (!values.every(numeric)) return false;
  return values.every(
    (value, index) =>
      index === 0 ||
      (rule.direction === "desc"
        ? compareNumericValues(values[index - 1], value) >= 0
        : compareNumericValues(values[index - 1], value) <= 0),
  );
}
