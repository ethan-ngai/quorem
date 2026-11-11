import { collectionProjection, sequenceTarget } from "@quorem/questions";
import type { Constraint, ConstraintTarget } from "@quorem/contracts";

export const constraintOperators = {
  eq: "=",
  ne: "≠",
  le: "≤",
  lt: "<",
  ge: "≥",
  gt: ">",
} as const;
const indices = "ijklmnopq";

export function formatTarget(
  target: ConstraintTarget,
  qualifyNodes = false,
  firstIndex = 0,
): string {
  let name = target.parameter;
  let index = firstIndex;
  for (const step of target.path ?? [])
    name += `[${step === "each" ? (indices[index++] ?? "*") : step}]`;
  switch (target.projection) {
    case "graph":
      return name;
    case "indices":
      return `indices(${name})[${indices[index] ?? "*"}]`;
    case "diagonal":
      return `${name}[${indices[index]}][${indices[index]}]`;
    case "columns":
      return `columns(${name})`;
    case "value":
      return name;
    case "sum":
      return `sum(${name})`;
    case "length":
      return `${name}.length`;
    case "elements":
    case "characters":
      return `${name}[${indices[index] ?? "*"}]`;
    case "nodeCount":
      return `node_count(${name})`;
    case "nodeValues":
      return qualifyNodes ? `node_values(${name})` : "node.val";
  }
}

export const arithmeticOperators = { add: "+", subtract: "−", multiply: "×" } as const;

export function formatMeasurement(
  target: ConstraintTarget,
  qualify = false,
  firstIndex = 0,
): string {
  let name = formatTarget(target, qualify, firstIndex);
  if (target.total) name = `sum(${name})`;
  if (target.offset) name += ` ${formatOffset(target.offset)}`;
  let compound = !!target.offset;
  for (const { operator, operand } of target.operations ?? []) {
    const right =
      typeof operand === "number"
        ? formatBound(operand)
        : formatMeasurement(operand, true, firstIndex);
    const nested =
      typeof operand === "number" ? operand < 0 : operand.offset || operand.operations?.length;
    name = `${compound ? `(${name})` : name} ${arithmeticOperators[operator]} ${nested ? `(${right})` : right}`;
    compound = true;
  }
  return name;
}

export function formatBound(value: number): string {
  const absolute = Math.abs(value);
  for (const base of [10, 2]) {
    const power = Math.round(Math.log(absolute) / Math.log(base));
    if (power >= 4 && base ** power === absolute) return `${value < 0 ? "-" : ""}${base}^${power}`;
    const nextPower = Math.round(Math.log(absolute + 1) / Math.log(base));
    if (nextPower >= 4 && base ** nextPower === absolute + 1)
      return value < 0 ? `-(${base}^${nextPower} - 1)` : `${base}^${nextPower} - 1`;
  }
  return String(value);
}

export function formatOffset(offset?: number) {
  return offset ? `${offset < 0 ? "-" : "+"} ${formatBound(Math.abs(offset))}` : "";
}

type Property = Extract<Constraint, { kind: "property" }>;
type Membership = Extract<Constraint, { kind: "membership" }>;

export function formatProperty(rule: Property, code = (value: string) => value) {
  const { target } = rule;
  const name = formatMeasurement(target);
  const nodes = target.projection === "nodeValues";
  const sequence = sequenceTarget(target);
  const scoped = target.path?.includes("each") && collectionProjection(target);
  const column = target.projection === "columns" && !target.total;
  const subject = nodes
    ? `Node values in ${code(target.parameter)}`
    : column
      ? `Each column of ${code(target.parameter)}`
      : sequence
        ? `Values of ${code(name)}`
        : code(name);
  const are = sequence && !column ? "are" : "is";
  const scope = scoped ? " within each sequence" : "";
  switch (rule.property) {
    case "tree":
      return `${code(name)} represents a tree`;
    case "binaryTree":
      return `${code(name)} represents a binary tree`;
    case "star":
      return `${code(name)} represents a star graph`;
    case "acyclic":
      return `${code(name)} represents an acyclic graph`;
    case "noLoops":
      return `${code(name)} has no self-loops`;
    case "noParallelEdges":
      return `${code(name)} has no parallel edges`;
    case "symmetric":
      return `${code(target.parameter)} is symmetric`;
    case "unique":
      return column
        ? `${subject} contains unique values`
        : sequence
          ? `${subject} are unique${scope}`
          : `${subject} contains unique values`;
    case "adjacentDistinct":
      return `Consecutive values of ${code(name)} differ${scope}`;
    case "even":
      return `${subject} ${are} even`;
    case "powerOfTwo":
      return `${subject} ${are} ${sequence ? "powers" : "a power"} of 2`;
    default: {
      const descending = rule.direction === "desc";
      const order =
        rule.property === "strictlySorted"
          ? descending
            ? "strictly decreasing"
            : "strictly increasing"
          : descending
            ? "nonincreasing"
            : "nondecreasing";
      return `${subject} ${are} in ${order} order${scope}`;
    }
  }
}

export function membershipValues(rule: Membership): (string | number | boolean | null)[] {
  const values: ReturnType<typeof membershipValues> = [...rule.values];
  for (const alphabet of [
    "abcdefghijklmnopqrstuvwxyz",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "0123456789",
  ]) {
    const characters = Array.from(alphabet);
    if (
      rule.target.projection !== "characters" ||
      !characters.every((letter) => values.includes(letter))
    )
      continue;
    values.splice(
      0,
      values.length,
      ...values.filter((value) => !characters.includes(String(value))),
      characters[0]!,
      null,
      characters.at(-1)!,
    );
  }
  return values;
}

export function formatConstraint(constraint: Constraint | string): string {
  if (typeof constraint === "string") return constraint;
  if (
    (constraint.kind === "range" || constraint.kind === "comparison") &&
    constraint.quantifier === "any"
  )
    return `∃: ${formatConstraint({ ...constraint, quantifier: undefined })}`;
  const measurement = formatMeasurement;
  switch (constraint.kind) {
    case "prose":
      return constraint.text;
    case "range": {
      const target = measurement(constraint.target);
      const suffix =
        constraint.target.projection === "nodeValues"
          ? ` (nodes in ${constraint.target.parameter})`
          : "";
      const lower = constraint.minInclusive === false ? "<" : "≤";
      const upper = constraint.maxInclusive === false ? "<" : "≤";
      if (constraint.min !== undefined && constraint.min === constraint.max)
        return `${target} = ${formatBound(constraint.min)}${suffix}`;
      if (constraint.min !== undefined && constraint.max !== undefined)
        return `${formatBound(constraint.min)} ${lower} ${target} ${upper} ${formatBound(constraint.max)}${suffix}`;
      return constraint.min !== undefined
        ? `${target} ${constraint.minInclusive === false ? ">" : "≥"} ${formatBound(constraint.min)}${suffix}`
        : `${target} ${upper} ${formatBound(constraint.max!)}${suffix}`;
    }
    case "comparison":
      return `${measurement(constraint.left, true)} ${constraintOperators[constraint.operator]} ${measurement(constraint.right, true, comparisonRightIndex(constraint))}${constraint.pairing ? " at matching positions" : ""}`;
    case "property":
      return formatProperty(constraint);
    case "definition":
      return `${constraint.name} = ${measurement(constraint.target, true)}`;
    case "membership":
      return `${measurement(constraint.target, true)} ${constraint.negated ? "∉" : "∈"} {${membershipValues(
        constraint,
      )
        .map((value) => (value === null ? "…" : JSON.stringify(value)))
        .join(", ")}}`;
  }
}

export function comparisonRightIndex(rule: Extract<Constraint, { kind: "comparison" }>) {
  if (rule.pairing) return 0;
  return (
    (rule.left.path?.filter((step) => step === "each").length ?? 0) +
    (["elements", "characters"].includes(rule.left.projection) ? 1 : 0)
  );
}
