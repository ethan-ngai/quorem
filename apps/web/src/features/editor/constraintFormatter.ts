import type { Constraint, ConstraintTarget } from "@quorem/contracts";

export function formatTarget(target: ConstraintTarget): string {
  const name = target.parameter;
  switch (target.projection) {
    case "value":
      return name;
    case "length":
      return `len(${name})`;
    case "elements":
      return `${name}[i]`;
    case "nodeCount":
      return `node_count(${name})`;
    case "nodeValues":
      return `node.val`;
  }
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

export function formatConstraint(constraint: Constraint | string): string {
  if (typeof constraint === "string") return constraint;
  switch (constraint.kind) {
    case "prose":
      return constraint.text;
    case "range": {
      const target = formatTarget(constraint.target);
      const suffix =
        constraint.target.projection === "nodeValues"
          ? ` (nodes in ${constraint.target.parameter})`
          : "";
      if (constraint.min !== undefined && constraint.max !== undefined)
        return `${formatBound(constraint.min)} ≤ ${target} ≤ ${formatBound(constraint.max)}${suffix}`;
      return constraint.min !== undefined
        ? `${target} ≥ ${formatBound(constraint.min)}${suffix}`
        : `${target} ≤ ${formatBound(constraint.max!)}${suffix}`;
    }
    case "comparison":
      return `${formatTarget(constraint.left)} ${{ eq: "=", le: "≤", lt: "<", ge: "≥", gt: ">" }[constraint.operator]} ${formatTarget(constraint.right)}`;
    case "property": {
      const nodes = constraint.target.projection === "nodeValues";
      const subject = nodes
        ? `Node values in ${constraint.target.parameter}`
        : constraint.target.parameter;
      if (constraint.property === "unique")
        return `${subject} ${nodes ? "are unique" : "contains unique values"}`;
      return `${subject} ${nodes ? "are" : "is"} sorted in nondecreasing order`;
    }
  }
}
