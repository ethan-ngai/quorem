import type { CustomCase } from "@quorem/contracts";

export type WireValue = CustomCase["args"][number];

export function innerType(type: string, wrapper: "optional" | "list" | "array") {
  if (wrapper === "list" && type.startsWith("array<")) return type.slice(6, -1);
  return type.startsWith(`${wrapper}<`) && type.endsWith(">")
    ? type.slice(wrapper.length + 1, -1)
    : undefined;
}

export function supportedType(type: string, depth = 0): boolean {
  if (depth > 100) return false;
  if (["int", "float", "str", "bool", "ListNode", "TreeNode"].includes(type)) return true;
  const inner = innerType(type, "optional") ?? innerType(type, "list");
  return inner !== undefined && supportedType(inner, depth + 1);
}

/** Matches the trusted server codec, including total nested collection size. */
export function validateTypedValue(
  type: string,
  value: unknown,
  depth = 0,
  count = { value: 0 },
): asserts value is WireValue {
  if (depth === 0 && !supportedType(type))
    throw new Error(`Unsupported or excessively nested type ${type}; a server codec is required.`);
  if (depth > 100) throw new Error("Nesting exceeds 100 levels.");
  if (depth > 0 && ++count.value > 10_000) throw new Error("Collection exceeds 10,000 elements.");
  const optional = innerType(type, "optional");
  if (optional) {
    if (value !== null) validateTypedValue(optional, value, depth + 1, count);
    return;
  }
  const list = innerType(type, "list");
  if (list) {
    if (!Array.isArray(value)) throw new Error("Enter a JSON array.");
    for (const item of value) validateTypedValue(list, item, depth + 1, count);
    return;
  }
  if (type === "ListNode" || type === "TreeNode") {
    if (value === null) return;
    if (!Array.isArray(value)) throw new Error("Enter a node array or null.");
    if (value.length > 10_000) throw new Error("At most 10,000 node entries.");
    let length = value.length;
    if (type === "TreeNode") while (length > 0 && value[length - 1] === null) length--;
    let slots = 1;
    for (let index = 0; index < length; index++) {
      const item: unknown = value[index];
      if (type === "TreeNode") {
        if (slots === 0) throw new Error("Tree contains an orphan node.");
        slots--;
        if (item === null) continue;
        if (index === 0 && item === null) throw new Error("A null root cannot have children.");
        slots += 2;
      }
      validateTypedValue("int", item, depth + 1, count);
    }
    if (type === "TreeNode" && length > 0 && value[0] === null)
      throw new Error("A null root cannot have children.");
    return;
  }
  if (type === "int") {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < -2_147_483_648 ||
      value > 2_147_483_647
    )
      throw new Error("Enter a signed 32-bit integer.");
  } else if (type === "float") {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error("Enter a finite number.");
  } else if (type === "str") {
    if (typeof value !== "string") throw new Error("Enter a string.");
  } else if (type === "bool") {
    if (typeof value !== "boolean") throw new Error("Choose true or false.");
  } else throw new Error(`Unsupported type ${type}; a server codec is required.`);
}
