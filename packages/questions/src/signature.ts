/** @file signature.ts @description Signature and input preset rules. @module questions */
import type { InputPresetConfig, Signature } from "./model";

/** Check the recursive public value type grammar. */
export function validQuestionType(type: string, depth = 0): boolean {
  if (depth > 100) return false;
  if (["int", "float", "bool", "str", "datetime", "ListNode", "TreeNode"].includes(type))
    return true;
  return ["optional<", "list<", "array<"].some(
    (prefix) =>
      type.startsWith(prefix) &&
      type.endsWith(">") &&
      validQuestionType(type.slice(prefix.length, -1), depth + 1),
  );
}

/** Validate a type and optional editor input preset. */
export function validateInputConfig(type: string, config?: InputPresetConfig): void {
  let normalized = type.replaceAll("array<", "list<");
  if (!validQuestionType(normalized))
    throw new Error(`unknown input codec ${JSON.stringify(normalized)}`);
  if (!config) return;
  while (normalized.startsWith("optional<")) normalized = normalized.slice(9, -1);
  const primitive = (t: string) => ["int", "float", "str", "bool"].includes(t);
  const innerList = (t: string) =>
    t.startsWith("list<") && t.endsWith(">") ? t.slice(5, -1) : undefined;
  const element = innerList(normalized);
  const inner = element === undefined ? undefined : innerList(element);
  const compatible: Record<string, boolean> = {
    default: true,
    structured: true,
    number: ["int", "float"].includes(normalized),
    text: normalized === "str",
    boolean: normalized === "bool",
    sequence: element !== undefined && primitive(element),
    matrix: inner !== undefined && primitive(inner),
    tree: normalized === "TreeNode",
    linkedList: normalized === "ListNode",
  };
  if (!Object.hasOwn(compatible, config.preset))
    throw new Error(`unknown input preset ${JSON.stringify(config.preset)}`);
  if (!compatible[config.preset])
    throw new Error(
      `input preset ${JSON.stringify(config.preset)} incompatible with ${normalized}`,
    );
  if (
    config.rows !== undefined &&
    (!Number.isInteger(config.rows) || config.rows < 1 || config.rows > 8)
  )
    throw new Error("input rows must be 1 to 8");
  if (
    config.placeholder !== undefined &&
    (Array.from(config.placeholder).length > 512 ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        config.placeholder,
      ))
  )
    throw new Error("input placeholder exceeds 512 characters");
}

/** Validate a signature; void is reserved for staged methods. */
export function validateSignature(sig: Signature, allowVoid = false): void {
  const symbol = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  if (
    sig.className !== "Solution" ||
    !symbol.test(sig.methodName) ||
    sig.methodName.length > 80 ||
    sig.parameters.length > 16 ||
    (sig.outputOrder !== undefined &&
      sig.outputOrder !== "ordered" &&
      !(sig.outputOrder === "unordered" && /^(list|array)</.test(sig.returnType)))
  )
    throw new Error("Solution class and valid method name required");
  const names = new Set<string>();
  for (const p of sig.parameters) {
    if (!symbol.test(p.name) || p.name.length > 80 || names.has(p.name))
      throw new Error("invalid or duplicate parameter");
    names.add(p.name);
    validateInputConfig(p.type, p.input);
  }
  if (!(allowVoid && sig.returnType === "void")) validateInputConfig(sig.returnType);
}
