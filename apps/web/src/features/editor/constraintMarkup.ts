import type { Constraint, ConstraintTarget } from "@quorem/contracts";
import { formatBound, formatTarget } from "./constraintFormatter";

function code(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(0, ...runs.map((run) => run.length)) + 1);
  return `${fence} ${value} ${fence}`;
}

type FormulaPart = { math: string } | { code: string };

function targetMarkup(target: ConstraintTarget, qualifyNodes = false): FormulaPart {
  const literal = formatTarget(target, qualifyNodes);
  if (target.projection !== "value") return { code: literal };
  const name = /^([A-Za-z])(?:_([A-Za-z0-9]+))?$/.exec(literal);
  return name ? { math: name[2] ? `${name[1]}_{${name[2]}}` : name[1]! } : { code: literal };
}

function boundMarkup(value: number): string {
  return formatBound(value).replace(/\^(-?\d+)/g, "^{$1}");
}

/** Compose prose and inline math from constraint metadata, without rewriting source text. */
export function constraintMarkup(constraint: Constraint | string): string {
  if (typeof constraint === "string") return constraint;
  const quantifier =
    "quantifier" in constraint && constraint.quantifier === "any" ? "\\exists\\,:\\;" : "";
  function formula(...parts: (string | FormulaPart)[]) {
    const fragments: string[] = [];
    let math = quantifier;
    const flush = () => {
      if (math) fragments.push(`$${math.trim()}$`);
      math = "";
    };
    for (const part of parts) {
      if (typeof part === "object" && "code" in part) {
        flush();
        fragments.push(code(part.code));
      } else {
        math += ` ${typeof part === "string" ? part : part.math}`;
      }
    }
    flush();
    return fragments.join(" ");
  }
  switch (constraint.kind) {
    case "prose":
      return constraint.text;
    case "range": {
      const target = targetMarkup(constraint.target);
      const suffix =
        constraint.target.projection === "nodeValues"
          ? ` (nodes in ${code(constraint.target.parameter)})`
          : "";
      const lower = constraint.minInclusive === false ? "<" : "\\le";
      const upper = constraint.maxInclusive === false ? "<" : "\\le";
      if (constraint.min !== undefined && constraint.max !== undefined)
        return (
          formula(boundMarkup(constraint.min), lower, target, upper, boundMarkup(constraint.max)) +
          suffix
        );
      return constraint.min !== undefined
        ? formula(
            target,
            constraint.minInclusive === false ? ">" : "\\ge",
            boundMarkup(constraint.min),
          ) + suffix
        : formula(target, upper, boundMarkup(constraint.max!)) + suffix;
    }
    case "comparison": {
      const operator = { eq: "=", le: "\\le", lt: "<", ge: "\\ge", gt: ">" }[constraint.operator];
      return formula(
        targetMarkup(constraint.left, true),
        operator,
        targetMarkup(constraint.right, true),
      );
    }
    case "property": {
      const nodes = constraint.target.projection === "nodeValues";
      const subject = nodes
        ? `Node values in ${code(constraint.target.parameter)}`
        : code(constraint.target.parameter);
      return constraint.property === "unique"
        ? `${subject} ${nodes ? "are unique" : "contains unique values"}`
        : `${subject} ${nodes ? "are" : "is"} sorted in ${constraint.direction === "desc" ? "nonincreasing" : "nondecreasing"} order`;
    }
  }
}
