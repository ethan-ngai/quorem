import type { Constraint, ConstraintTarget } from "@quorem/contracts";
import {
  comparisonRightIndex,
  formatBound,
  formatOffset,
  formatProperty,
  formatTarget,
  membershipValues,
} from "./constraintFormatter";

function code(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(0, ...runs.map((run) => run.length)) + 1);
  return `${fence} ${value} ${fence}`;
}

type FormulaPart = { math: string } | { code: string };

function targetMarkup(target: ConstraintTarget, qualifyNodes = false, firstIndex = 0): FormulaPart {
  const literal = formatTarget(target, qualifyNodes, firstIndex);
  if (target.projection !== "value") return { code: literal };
  const name = /^([A-Za-z])(?:_([A-Za-z0-9]+))?$/.exec(literal);
  return name ? { math: name[2] ? `${name[1]}_{${name[2]}}` : name[1]! } : { code: literal };
}

function boundMarkup(value: number): string {
  return formatBound(value).replace(/\^(-?\d+)/g, "^{$1}");
}

function formula(parts: (string | FormulaPart)[], quantifier = "") {
  const fragments: string[] = [];
  let math = quantifier;
  const flush = () => {
    if (math) fragments.push(`$${math.trim()}$`);
    math = "";
  };
  for (const part of parts) {
    if (part === ",") {
      if (math) math += ",";
      else fragments[fragments.length - 1] += ",";
    } else if (typeof part === "object" && "code" in part) {
      flush();
      fragments.push(code(part.code));
    } else {
      math += ` ${typeof part === "string" ? part : part.math}`;
    }
  }
  flush();
  return fragments.join(" ");
}

function targetExpression(
  target: ConstraintTarget,
  qualify = false,
  firstIndex = 0,
): (string | FormulaPart)[] {
  let parts: (string | FormulaPart)[] = [targetMarkup(target, qualify, firstIndex)];
  if (target.total) parts.unshift("\\sum");
  if (target.offset) parts.push(formatOffset(target.offset).replace(/\^(-?\d+)/g, "^{$1}"));
  let compound = !!target.offset;
  for (const { operator, operand } of target.operations ?? []) {
    const right =
      typeof operand === "number"
        ? [boundMarkup(operand)]
        : targetExpression(operand, true, firstIndex);
    const nested =
      typeof operand === "number" ? operand < 0 : operand.offset || operand.operations?.length;
    if (compound) parts = ["(", ...parts, ")"];
    parts.push(
      { add: "+", subtract: "-", multiply: "\\cdot" }[operator],
      ...(nested ? ["(", ...right, ")"] : right),
    );
    compound = true;
  }
  return parts;
}

/** Compose prose and inline math from constraint metadata, without rewriting source text. */
export function constraintMarkup(constraint: Constraint | string): string {
  if (typeof constraint === "string") return constraint;
  const quantifier =
    "quantifier" in constraint && constraint.quantifier === "any" ? "\\exists\\,:\\;" : "";
  const render = (...parts: (string | FormulaPart)[]) => formula(parts, quantifier);
  switch (constraint.kind) {
    case "prose":
      return constraint.text;
    case "range": {
      const target = targetExpression(constraint.target);
      const suffix =
        constraint.target.projection === "nodeValues"
          ? ` (nodes in ${code(constraint.target.parameter)})`
          : "";
      const lower = constraint.minInclusive === false ? "<" : "\\le";
      const upper = constraint.maxInclusive === false ? "<" : "\\le";
      if (constraint.min !== undefined && constraint.min === constraint.max)
        return render(...target, "=", boundMarkup(constraint.min)) + suffix;
      if (constraint.min !== undefined && constraint.max !== undefined)
        return (
          render(
            boundMarkup(constraint.min),
            lower,
            ...target,
            upper,
            boundMarkup(constraint.max),
          ) + suffix
        );
      return constraint.min !== undefined
        ? render(
            ...target,
            constraint.minInclusive === false ? ">" : "\\ge",
            boundMarkup(constraint.min),
          ) + suffix
        : render(...target, upper, boundMarkup(constraint.max!)) + suffix;
    }
    case "comparison": {
      const operator = { eq: "=", ne: "\\ne", le: "\\le", lt: "<", ge: "\\ge", gt: ">" }[
        constraint.operator
      ];
      return (
        render(
          ...targetExpression(constraint.left, true),
          operator,
          ...targetExpression(constraint.right, true, comparisonRightIndex(constraint)),
        ) + (constraint.pairing ? " at matching positions" : "")
      );
    }
    case "property":
      return formatProperty(constraint, code);
    case "definition":
      return render(
        {
          math: /^[A-Za-z](?:_[A-Za-z0-9]+)?$/.test(constraint.name)
            ? constraint.name.replace(/_(.+)$/, "_{$1}")
            : `\\mathrm{${constraint.name.replaceAll("_", "\\_")}}`,
        },
        "=",
        ...targetExpression(constraint.target, true),
      );
    case "membership":
      return render(
        ...targetExpression(constraint.target, true),
        constraint.negated ? "\\notin \\{" : "\\in \\{",
        ...membershipValues(constraint).flatMap((value, index) => [
          ...(index ? [","] : []),
          value === null
            ? "\\ldots"
            : typeof value === "number"
              ? boundMarkup(value)
              : { code: JSON.stringify(value) },
        ]),
        "\\}",
      );
  }
}

/** Compact the public display while leaving each independently enforced rule intact. */
export function constraintListMarkup(constraints: readonly Constraint[]): string[] {
  type Range = Extract<Constraint, { kind: "range" }>;
  const lower = new Map<string, { index: number; rule: Range }>();
  const upper = new Map<string, { index: number; rule: Range }>();
  const shared = new Map<string, { index: number; rule: Range }[]>();
  const hidden = new Set<number>();
  const replacement = new Map<number, string>();

  constraints.forEach((rule, index) => {
    if (
      rule.kind !== "range" ||
      rule.target.projection === "nodeValues" ||
      rule.target.offset ||
      rule.target.operations ||
      rule.target.total ||
      rule.quantifier === "any"
    )
      return;
    if (rule.min !== undefined && rule.max !== undefined) {
      const key = JSON.stringify([
        rule.min,
        rule.max,
        rule.minInclusive !== false,
        rule.maxInclusive !== false,
      ]);
      const group = shared.get(key) ?? [];
      group.push({ index, rule });
      shared.set(key, group);
    } else if (rule.target.projection === "value" && !rule.target.path) {
      (rule.min !== undefined ? lower : upper).set(rule.target.parameter, { index, rule });
    }
  });

  constraints.forEach((rule, index) => {
    if (
      rule.kind !== "comparison" ||
      rule.operator === "eq" ||
      rule.operator === "ne" ||
      rule.left.path ||
      rule.right.path ||
      rule.left.offset ||
      rule.right.offset ||
      rule.left.operations ||
      rule.right.operations ||
      rule.left.total ||
      rule.right.total ||
      rule.pairing ||
      rule.quantifier === "any" ||
      rule.left.projection !== "value" ||
      rule.right.projection !== "value"
    )
      return;
    const [left, right] =
      rule.operator === "lt" || rule.operator === "le"
        ? [rule.left, rule.right]
        : [rule.right, rule.left];
    const start = lower.get(left.parameter);
    const end = upper.get(right.parameter);
    if (!start && !end) return;

    const parts: (string | FormulaPart)[] = [];
    if (start) {
      parts.push(boundMarkup(start.rule.min!), start.rule.minInclusive === false ? "<" : "\\le");
      hidden.add(start.index);
    }
    parts.push(
      targetMarkup(left),
      rule.operator === "lt" || rule.operator === "gt" ? "<" : "\\le",
      targetMarkup(right),
    );
    if (end) {
      parts.push(end.rule.maxInclusive === false ? "<" : "\\le", boundMarkup(end.rule.max!));
      hidden.add(end.index);
    }
    replacement.set(index, formula(parts));
  });

  for (const group of shared.values()) {
    if (group.length < 2) continue;
    const first = group[0]!;
    const { min, max, minInclusive, maxInclusive } = first.rule;
    const targets = group.flatMap(({ rule }, index) =>
      index ? [",", targetMarkup(rule.target)] : [targetMarkup(rule.target)],
    );
    replacement.set(
      first.index,
      formula(
        min === max
          ? [...targets, "=", boundMarkup(min!)]
          : [
              boundMarkup(min!),
              minInclusive === false ? "<" : "\\le",
              ...targets,
              maxInclusive === false ? "<" : "\\le",
              boundMarkup(max!),
            ],
      ),
    );
    for (const entry of group.slice(1)) hidden.add(entry.index);
  }

  return constraints.flatMap((rule, index) =>
    hidden.has(index) ? [] : [replacement.get(index) ?? constraintMarkup(rule)],
  );
}
