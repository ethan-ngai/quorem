import { nodeType } from "./node-type.ts";

const scalarTypes: ReadonlyMap<string, string> = new Map([
  ["void", "void"],
  ["int", "int"],
  ["long", "long"],
  ["float", "double"],
  ["bool", "boolean"],
  ["str", "String"],
  ["datetime", "LocalDateTime"],
  ["ListNode", "ListNode"],
  ["TreeNode", "TreeNode"],
]);

const boxedTypes: ReadonlyMap<string, string> = new Map([
  ["int", "Integer"],
  ["long", "Long"],
  ["double", "Double"],
  ["boolean", "Boolean"],
]);

function box(type: string) {
  return boxedTypes.get(type) ?? type;
}

/** Source and previews use the short names provided by the Java judge's imports. */
export function javaQuestionType(type: string): string | undefined {
  const node = nodeType(type);
  if (node?.generic) {
    const payload = scalarTypes.get(node.payload)!;
    return `Typed${node.kind}<${box(payload)}>`;
  }
  for (const wrapper of ["optional", "array", "list"] as const) {
    if (!type.startsWith(`${wrapper}<`) || !type.endsWith(">")) continue;
    const inner = javaQuestionType(type.slice(wrapper.length + 1, -1));
    if (!inner) return;
    if (wrapper === "optional") return box(inner);
    if (wrapper === "array") return `${inner}[]`;
    return `List<${box(inner)}>`;
  }
  return scalarTypes.get(type);
}
