/** @file constraints.ts @description Structured constraint metadata validation. @module questions */
import type { Constraint, ConstraintTarget, Signature } from "./model";
import { validQuestionType, validateInputConfig } from "./signature";

function targetType(sig: Signature, target: ConstraintTarget): "scalar" | "sequence" | "string" {
  const type = sig.parameters
    .find((p) => p.name === target.parameter)
    ?.type.replaceAll("array<", "list<");
  if (!type) throw new Error(`unknown parameter ${JSON.stringify(target.parameter)}`);
  switch (target.projection) {
    case "value":
      if (type === "int" || type === "float") return "scalar";
      if (type === "str") return "string";
      break;
    case "length":
      if (type === "str" || type.startsWith("list<")) return "scalar";
      break;
    case "sum":
      if (["list<int>", "list<float>"].includes(type)) return "scalar";
      break;
    case "elements":
      if (["list<int>", "list<float>"].includes(type)) return "sequence";
      break;
    case "nodeCount":
      if (["ListNode", "TreeNode"].includes(type)) return "scalar";
      break;
    case "nodeValues":
      if (["ListNode", "TreeNode"].includes(type)) return "sequence";
      break;
  }
  throw new Error(
    `parameter ${target.parameter}: projection ${target.projection} invalid for ${type}`,
  );
}

/** Validate constraint projections and bounds against a signature. */
export function validateConstraints(sig: Signature, constraints: readonly Constraint[]): void {
  const names = new Set<string>();
  for (const p of sig.parameters) {
    if (!p.name || names.has(p.name) || !validQuestionType(p.type))
      throw new Error(`invalid signature parameter ${JSON.stringify(p.name)}`);
    validateInputConfig(p.type, p.input);
    names.add(p.name);
  }
  if (sig.returnType !== "void" && !validQuestionType(sig.returnType))
    throw new Error("invalid return type");
  constraints.forEach((c, i) => {
    try {
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
            (c.min !== undefined && !Number.isFinite(c.min)) ||
            (c.max !== undefined && !Number.isFinite(c.max))
          )
            throw new Error("nonfinite bound");
          if (c.min !== undefined && c.max !== undefined && c.min > c.max)
            throw new Error("reversed bounds");
          break;
        }
        case "comparison":
          if (targetType(sig, c.left) !== "scalar" || targetType(sig, c.right) !== "scalar")
            throw new Error("comparison requires scalar targets");
          if (!["eq", "le", "lt", "ge", "gt"].includes(c.operator))
            throw new Error("invalid comparison operator");
          break;
        case "property": {
          const type = targetType(sig, c.target);
          if (type !== "sequence" && type !== "string")
            throw new Error("property requires a sequence");
          if (!["unique", "sorted", "nondecreasing"].includes(c.property))
            throw new Error("unsupported property");
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
