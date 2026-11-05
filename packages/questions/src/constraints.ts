/** @file constraints.ts @description Structured constraint metadata validation. @module questions */
import { nodeType } from "@quorem/contracts/node-type";
import type { Constraint, ConstraintTarget, Signature } from "./model.ts";
import { validQuestionType } from "./signature.ts";

function targetType(sig: Signature, target: ConstraintTarget): "scalar" | "sequence" | "string" {
  const type = sig.parameters
    .find((p) => p.name === target.parameter)
    ?.type.replaceAll("array<", "list<");
  if (!type) throw new Error(`unknown parameter ${JSON.stringify(target.parameter)}`);
  switch (target.projection) {
    case "value":
      if (type === "int" || type === "long" || type === "float") return "scalar";
      if (type === "str") return "string";
      break;
    case "length":
      if (type === "str" || type.startsWith("list<")) return "scalar";
      break;
    case "sum":
      if (["list<int>", "list<long>", "list<float>"].includes(type)) return "scalar";
      break;
    case "elements":
      if (["list<int>", "list<long>", "list<float>"].includes(type)) return "sequence";
      break;
    case "nodeCount":
      if (nodeType(type)) return "scalar";
      break;
    case "nodeValues":
      if (["int", "long", "float"].includes(nodeType(type)?.payload ?? "")) return "sequence";
      break;
  }
  throw new Error(
    `parameter ${target.parameter}: projection ${target.projection} invalid for ${type}`,
  );
}

type Comparison = Extract<Constraint, { kind: "comparison" }>;
const relations = ["eq", "le", "lt", "ge", "gt"] as const;
const projections: ConstraintTarget["projection"][] = [
  "value",
  "length",
  "elements",
  "sum",
  "nodeCount",
  "nodeValues",
];

function sameTarget(a: ConstraintTarget, b: ConstraintTarget) {
  return a.parameter === b.parameter && a.projection === b.projection;
}
function sequenceTarget(target: ConstraintTarget) {
  return target.projection === "elements" || target.projection === "nodeValues";
}

/** One compatibility policy for validation and dependent editor choices. */
export function comparisonRelations(rule: Comparison): readonly Comparison["operator"][] {
  if (!sameTarget(rule.left, rule.right)) return relations;
  if (!sequenceTarget(rule.left)) return [];
  return rule.quantifier === "any" ? ["lt", "gt"] : ["eq", "le", "ge"];
}

export function constraintTargetOptions(
  signature: Signature | undefined,
  kind: Exclude<Constraint["kind"], "prose">,
): ConstraintTarget[] {
  if (!signature) return [];
  return signature.parameters
    .filter(({ name }) => !!name)
    .flatMap((parameter) =>
      projections.flatMap((projection) => {
        const target = { parameter: parameter.name, projection };
        try {
          const type = targetType({ ...signature, parameters: [parameter] }, target);
          return (kind === "property" ? type !== "scalar" : type !== "string") ? [target] : [];
        } catch {
          return [];
        }
      }),
    );
}

/** Each domain query is linear in available targets; no n-variable Cartesian enumeration. */
export function comparisonChoices(signature: Signature | undefined, rule: Comparison) {
  const targets = constraintTargetOptions(signature, "comparison");
  const modes = (["all", "any"] as const).flatMap((quantifier) =>
    comparisonRelations({ ...rule, quantifier }).map((operator) => ({ quantifier, operator })),
  );
  return {
    left: targets.filter((left) => comparisonRelations({ ...rule, left }).includes(rule.operator)),
    right: targets.filter((right) =>
      comparisonRelations({ ...rule, right }).includes(rule.operator),
    ),
    operators: comparisonRelations(rule),
    reflexiveSequence: sameTarget(rule.left, rule.right) && sequenceTarget(rule.left),
    modes,
  };
}

/** Bind constraints to value types; signature validation owns editor preset compatibility. */
export function validateConstraints(sig: Signature, constraints: readonly Constraint[]): void {
  const names = new Set<string>();
  for (const p of sig.parameters) {
    if (!p.name || names.has(p.name) || !validQuestionType(p.type))
      throw new Error(`invalid signature parameter ${JSON.stringify(p.name)}`);
    names.add(p.name);
  }
  if (sig.returnType !== "void" && !validQuestionType(sig.returnType))
    throw new Error("invalid return type");
  constraints.forEach((c, i) => {
    try {
      if (
        (c.kind === "range" || c.kind === "comparison") &&
        c.quantifier !== undefined &&
        !["all", "any"].includes(c.quantifier)
      )
        throw new Error("unsupported quantifier");
      switch (c.kind) {
        case "prose":
          if (!c.text.trim()) throw new Error("invalid prose");
          break;
        case "range": {
          if (
            targetType(sig, c.target) === "string" ||
            (c.min === undefined && c.max === undefined)
          )
            throw new Error("invalid range");
          if (
            (c.minInclusive !== undefined && c.min === undefined) ||
            (c.maxInclusive !== undefined && c.max === undefined)
          )
            throw new Error("inclusivity requires a corresponding bound");
          if (
            [c.minInclusive, c.maxInclusive].some(
              (flag) => flag !== undefined && typeof flag !== "boolean",
            )
          )
            throw new Error("invalid range inclusivity");
          const type = sig.parameters
            .find((p) => p.name === c.target.parameter)
            ?.type.replaceAll("array<", "list<");
          if (
            (type === "long" ||
              (type === "list<long>" && c.target.projection !== "length") ||
              (type &&
                c.target.projection === "nodeValues" &&
                nodeType(type)?.payload === "long")) &&
            [c.min, c.max].some((bound) => bound !== undefined && !Number.isSafeInteger(bound))
          )
            throw new Error("long range bounds must be safe integers");
          if (
            (c.min !== undefined && !Number.isFinite(c.min)) ||
            (c.max !== undefined && !Number.isFinite(c.max))
          )
            throw new Error("nonfinite bound");
          if (c.min !== undefined && c.max !== undefined && c.min > c.max)
            throw new Error("reversed bounds");
          if (
            c.min !== undefined &&
            c.max !== undefined &&
            c.min === c.max &&
            (c.minInclusive === false || c.maxInclusive === false)
          )
            throw new Error("empty range");
          break;
        }
        case "comparison":
          if (targetType(sig, c.left) === "string" || targetType(sig, c.right) === "string")
            throw new Error("comparison requires numeric targets");
          if (!comparisonRelations(c).includes(c.operator)) {
            if (!sequenceTarget(c.left))
              throw new Error(
                "a scalar compared with itself is always true or always false; choose a different operand",
              );
            throw new Error(
              c.quantifier === "any"
                ? "an existential reflexive comparison only tests whether values exist; use < or > to test for differing values"
                : "every value cannot be strictly less/greater than itself; use =, ≤ or ≥ to require all values equal",
            );
          }
          if (!["eq", "le", "lt", "ge", "gt"].includes(c.operator))
            throw new Error("invalid comparison operator");
          break;
        case "property": {
          const type = targetType(sig, c.target);
          if (type !== "sequence" && type !== "string")
            throw new Error("property requires a sequence");
          if (!["unique", "sorted", "nondecreasing"].includes(c.property))
            throw new Error("unsupported property");
          if (
            c.direction !== undefined &&
            (c.property === "unique" || !["asc", "desc"].includes(c.direction))
          )
            throw new Error("direction requires an ordering property");
          if (type === "string" && c.property !== "unique")
            throw new Error("ordering requires numeric sequence");
          break;
        }
        default:
          throw new Error("unknown kind");
      }
    } catch (error) {
      throw new Error(
        `constraint ${i + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
