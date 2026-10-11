import type { Constraint, ConstraintTarget } from "@quorem/contracts";
import { formatBound, formatTarget } from "./constraintFormatter";

function code(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(0, ...runs.map((run) => run.length)) + 1);
  return `${fence} ${value} ${fence}`;
}

function targetMarkup(target: ConstraintTarget): string {
  return code(formatTarget(target));
}

function boundMarkup(value: number): string {
  return `$${formatBound(value).replace(/\^(-?\d+)/g, "^{$1}")}$`;
}

/** Compose prose and inline math from constraint metadata, without rewriting source text. */
export function constraintMarkup(constraint: Constraint | string): string {
  if (typeof constraint === "string") return constraint;
  switch (constraint.kind) {
    case "prose":
      return constraint.text;
    case "range": {
      const target = targetMarkup(constraint.target);
      const suffix =
        constraint.target.projection === "nodeValues"
          ? ` (nodes in ${code(constraint.target.parameter)})`
          : "";
      if (constraint.min !== undefined && constraint.max !== undefined)
        return `${boundMarkup(constraint.min)} $\\le$ ${target} $\\le$ ${boundMarkup(constraint.max)}${suffix}`;
      return constraint.min !== undefined
        ? `${target} $\\ge$ ${boundMarkup(constraint.min)}${suffix}`
        : `${target} $\\le$ ${boundMarkup(constraint.max!)}${suffix}`;
    }
    case "comparison": {
      const operator = { eq: "=", le: "\\le", lt: "<", ge: "\\ge", gt: ">" }[constraint.operator];
      return `${targetMarkup(constraint.left)} $${operator}$ ${targetMarkup(constraint.right)}`;
    }
    case "property": {
      const nodes = constraint.target.projection === "nodeValues";
      const subject = nodes
        ? `Node values in ${code(constraint.target.parameter)}`
        : code(constraint.target.parameter);
      return constraint.property === "unique"
        ? `${subject} ${nodes ? "are unique" : "contains unique values"}`
        : `${subject} ${nodes ? "are" : "is"} sorted in nondecreasing order`;
    }
  }
}
