import { compareNumericValues } from "@quorem/contracts/long";
import { graphPropertyMatches } from "./constraintGraph.ts";
import { compareUtf8, JsonNumber } from "./json.ts";
import type { QuestionGraph } from "./graph.ts";
import { collectionProjection } from "./constraintTargets.ts";
import type { Constraint, ConstraintTarget } from "./model.ts";

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

function satisfies(operator: Extract<Constraint, { kind: "comparison" }>["operator"], cmp: number) {
  return { eq: cmp === 0, ne: cmp !== 0, le: cmp <= 0, lt: cmp < 0, ge: cmp >= 0, gt: cmp > 0 }[
    operator
  ];
}

/** Quantify the cross-product in linear time; scalar operands naturally broadcast. */
export function comparisonMatches(
  rule: Extract<Constraint, { kind: "comparison" }>,
  left: readonly unknown[],
  right: readonly unknown[],
): boolean {
  if (!left.every(numeric) || !right.every(numeric)) return false;
  const any = rule.quantifier === "any";
  if (rule.pairing) {
    if (left.length !== right.length) return false;
    const match = (value: Numeric, index: number) =>
      satisfies(rule.operator, compareNumericValues(value, right[index]!));
    return any ? left.some(match) : left.every(match);
  }
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
  if (rule.operator === "ne") {
    if (any)
      return compareNumericValues(a.min, b.max) !== 0 || compareNumericValues(a.max, b.min) !== 0;
    const found = new Set(left.map(key));
    return right.every((value) => !found.has(key(value)));
  }
  const less = rule.operator === "lt" || rule.operator === "le";
  const cmp = compareNumericValues(any === less ? a.min : a.max, any === less ? b.max : b.min);
  return satisfies(rule.operator, cmp);
}

function valueKey(value: unknown): string {
  if (value instanceof JsonNumber) return key(Number(value.lexeme));
  if (numeric(value) || typeof value === "string") return key(value);
  if (Array.isArray(value)) return JSON.stringify(value.map(valueKey));
  return JSON.stringify(value);
}

export function propertyMatches(
  rule: Extract<Constraint, { kind: "property" }>,
  values: readonly unknown[],
): boolean {
  if (rule.target.projection === "graph")
    return graphPropertyMatches(rule.property, values[0] as QuestionGraph);
  if (rule.property === "symmetric")
    return values.every(
      (row, i) =>
        Array.isArray(row) &&
        row.length === values.length &&
        row.every((value, j) => valueKey(value) === valueKey((values[j] as unknown[])?.[i])),
    );
  if (rule.property === "unique") return new Set(values.map(valueKey)).size === values.length;
  if (rule.property === "adjacentDistinct")
    return values.every((value, i) => i === 0 || valueKey(value) !== valueKey(values[i - 1]));
  if (rule.property === "even" || rule.property === "powerOfTwo") {
    return values.every((value) => {
      if (typeof value !== "bigint" && !Number.isSafeInteger(value)) return false;
      const n = BigInt(value as number | bigint);
      return rule.property === "even" ? n % 2n === 0n : n > 0n && (n & (n - 1n)) === 0n;
    });
  }
  return values.every((value, index) => {
    if (index === 0) return true;
    const previous = values[index - 1];
    const comparison =
      numeric(previous) && numeric(value)
        ? compareNumericValues(previous, value)
        : typeof previous === "string" && typeof value === "string"
          ? compareUtf8(previous, value)
          : NaN;
    const cmp = comparison * (rule.direction === "desc" ? -1 : 1);
    return rule.property === "strictlySorted" ? cmp < 0 : cmp <= 0;
  });
}

export function constraintRuleTargets(rule: Constraint): ConstraintTarget[] {
  const collect = (target: ConstraintTarget): ConstraintTarget[] => [
    target,
    ...(target.operations ?? []).flatMap(({ operand }) =>
      typeof operand === "number" ? [] : collect(operand),
    ),
  ];
  if (rule.kind === "comparison") return [rule.left, rule.right].flatMap(collect);
  return rule.kind === "prose" ? [] : collect(rule.target);
}

export function constraintMatches(
  rule: Constraint,
  project: (target: ConstraintTarget) => unknown[][],
  type: (target: ConstraintTarget) => string,
): boolean {
  switch (rule.kind) {
    case "prose":
      return true;
    // A shared row length names a scalar only if all row lengths agree.
    case "definition": {
      const values = project(rule.target).flat();
      return (
        values.length > 0 &&
        values.every(
          (value) =>
            numeric(value) && numeric(values[0]) && compareNumericValues(value, values[0]) === 0,
        )
      );
    }
    case "range":
      return rangeMatches(rule, project(rule.target).flat());
    case "comparison":
      return comparisonMatches(rule, project(rule.left).flat(), project(rule.right).flat());
    case "membership": {
      const long = type(rule.target) === "long";
      const allowed = new Set<unknown>(
        rule.values.map((value) => (long ? BigInt(value as string) : value)),
      );
      return project(rule.target).every((group) =>
        group.every(
          (value) =>
            allowed.has(typeof value === "bigint" && !long ? Number(value) : value) !==
            (rule.negated === true),
        ),
      );
    }
    case "property": {
      const groups = project(rule.target);
      if (!rule.target.total && collectionProjection(rule.target))
        return groups.every((group) => propertyMatches(rule, group));
      const values = groups.flat();
      const value = values[0];
      return propertyMatches(
        rule,
        typeof value === "string" && !rule.target.path?.includes("each")
          ? Array.from(value)
          : values,
      );
    }
  }
}
