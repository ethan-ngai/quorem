/** @file constraints.ts @description Structured constraint metadata validation. @module questions */
import { graphEncodingForTarget } from "./graph.ts";
import { isLongValue } from "@quorem/contracts/long";
import {
  constraintTargetType,
  numericConstraintType,
  sameTarget,
  sequenceTarget,
} from "./constraintTargets.ts";
import type { Constraint, ConstraintTarget, Signature } from "./model.ts";
import { validQuestionType } from "./signature.ts";

type Comparison = Extract<Constraint, { kind: "comparison" }>;
const relations = ["eq", "le", "lt", "ge", "gt", "ne"] as const;
const projections: ConstraintTarget["projection"][] = [
  "value",
  "length",
  "elements",
  "sum",
  "nodeCount",
  "nodeValues",
  "characters",
  "indices",
  "diagonal",
  "columns",
  "graph",
];
const graphProperties = [
  "tree",
  "binaryTree",
  "star",
  "acyclic",
  "noLoops",
  "noParallelEdges",
] as const;
const ordering = ["sorted", "nondecreasing", "strictlySorted"];

function propertyAllowed(
  signature: Signature,
  target: ConstraintTarget,
  type: string,
  property: string,
) {
  if (type === "graph") {
    const encoding = graphEncodingForTarget(signature, target.parameter);
    if (property === "binaryTree") return encoding?.kind === "parent";
    if (property === "tree" || property === "star")
      return encoding?.directed === false || (property === "tree" && encoding?.kind === "parent");
    return graphProperties.some((candidate) => candidate === property);
  }
  if (property === "symmetric") return target.projection === "elements" && type.startsWith("list<");
  const sequence = sequenceTarget(target) || type === "str";
  if (property === "unique" || property === "adjacentDistinct") return sequence;
  if (ordering.includes(property))
    return sequenceTarget(target) && (numericConstraintType(type) || type === "str");
  return ["even", "powerOfTwo"].includes(property) && ["int", "long"].includes(type);
}

function compatible(
  signature: Signature,
  kind: Exclude<Constraint["kind"], "prose">,
  target: ConstraintTarget,
  type: string,
) {
  if (kind === "property")
    return (
      type === "graph" ||
      propertyAllowed(signature, target, type, "unique") ||
      propertyAllowed(signature, target, type, "even")
    );
  if (kind === "definition")
    return (
      numericConstraintType(type) && (!sequenceTarget(target) || target.projection === "length")
    );
  if (kind === "membership")
    return numericConstraintType(type) || type === "str" || type === "bool";
  return numericConstraintType(type);
}

/** One compatibility policy for validation and dependent editor choices. */
export function comparisonRelations(rule: Comparison): readonly Comparison["operator"][] {
  if (rule.pairing && (!sequenceTarget(rule.left) || !sequenceTarget(rule.right))) return [];
  if (!sameTarget(rule.left, rule.right)) return relations;
  if (rule.pairing) return [];
  if (!sequenceTarget(rule.left)) return [];
  return rule.quantifier === "any" ? ["lt", "gt", "ne"] : ["eq", "le", "ge"];
}

export function constraintTargetOptions(
  signature: Signature | undefined,
  kind: Exclude<Constraint["kind"], "prose">,
): ConstraintTarget[] {
  if (!signature) return [];
  return signature.parameters
    .filter(({ name }) => !!name)
    .flatMap((parameter) => {
      const paths: ConstraintTarget["path"][] = [undefined];
      let type = parameter.type.replaceAll("array<", "list<");
      for (let depth = 1; depth <= 8 && type.startsWith("list<"); depth++) {
        paths.push(Array.from({ length: depth }, () => "each" as const));
        type = type.slice(5, -1);
      }
      if (type === "str" && paths.length <= 8) paths.push([...(paths.at(-1) ?? []), 0]);
      return paths.flatMap((path) =>
        projections.flatMap((projection) => {
          const target = { parameter: parameter.name, projection, ...(path && { path }) };
          try {
            return compatible(signature, kind, target, constraintTargetType(signature, target))
              ? [target]
              : [];
          } catch {
            return [];
          }
        }),
      );
    });
}

export function constraintProperties(signature: Signature, target: ConstraintTarget) {
  try {
    const type = constraintTargetType(signature, target);
    return (
      [
        "unique",
        "nondecreasing",
        "strictlySorted",
        "adjacentDistinct",
        "even",
        "powerOfTwo",
        "symmetric",
        ...graphProperties,
      ] as const
    ).filter((property) => propertyAllowed(signature, target, type, property));
  } catch {
    return [];
  }
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
  const aliases = new Set<string>();
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
            !numericConstraintType(constraintTargetType(sig, c.target)) ||
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
          if (
            constraintTargetType(sig, c.target) === "long" &&
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
          if (
            ![c.left, c.right].every((target) =>
              numericConstraintType(constraintTargetType(sig, target)),
            )
          )
            throw new Error("comparison requires numeric targets");
          if (c.pairing !== undefined && c.pairing !== "corresponding")
            throw new Error("unsupported pairing");
          if (
            c.pairing &&
            (!sequenceTarget(c.left) || !sequenceTarget(c.right) || sameTarget(c.left, c.right))
          )
            throw new Error("matching positions require two different sequence targets");
          if (!comparisonRelations(c).includes(c.operator)) {
            if (!sequenceTarget(c.left))
              throw new Error(
                "A scalar cannot meaningfully compare with itself. Choose another operand.",
              );
            throw new Error(
              c.quantifier === "any"
                ? "∃ self-comparison: use < or > for distinct values."
                : "∀ self-comparison: use =, ≤ or ≥ for all-equal values.",
            );
          }
          break;
        case "property": {
          const type = constraintTargetType(sig, c.target);
          if (!propertyAllowed(sig, c.target, type, c.property))
            throw new Error("property is incompatible with this measurement");
          if (
            c.direction !== undefined &&
            (!ordering.includes(c.property) || !["asc", "desc"].includes(c.direction))
          )
            throw new Error("direction requires an ordering property");
          break;
        }
        case "definition":
          if (
            !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(c.name) ||
            names.has(c.name) ||
            aliases.has(c.name)
          )
            throw new Error(
              "a measurement name must be distinct from parameters and other definitions",
            );
          if (sequenceTarget(c.target) && (c.target.projection !== "length" || c.target.operations))
            throw new Error("a name must define a scalar measurement");
          if (!numericConstraintType(constraintTargetType(sig, c.target)))
            throw new Error("a name must define a numeric measurement");
          aliases.add(c.name);
          break;
        case "membership": {
          const type = constraintTargetType(sig, c.target);
          const validValue = (value: unknown) => {
            if (type === "long") return isLongValue(value);
            if (type === "str")
              return (
                typeof value === "string" &&
                value.length <= 256 &&
                (c.target.projection !== "characters" || Array.from(value).length === 1)
              );
            if (type === "bool") return typeof value === "boolean";
            if (type === "int") return Number.isSafeInteger(value);
            return type === "float" && Number.isFinite(value);
          };
          if (
            !c.values.length ||
            c.values.length > 128 ||
            new Set(c.values).size !== c.values.length ||
            !c.values.every(validValue) ||
            (c.negated !== undefined && typeof c.negated !== "boolean")
          )
            throw new Error(`membership requires distinct ${type} literals`);
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
