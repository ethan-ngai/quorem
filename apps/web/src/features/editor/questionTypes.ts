import { formatNodeLiteral, type NodeContext } from "./nodeLiterals";
import type { WireValue } from "./typedValues";
import { nodeType } from "@quorem/contracts/node-type";
import type { EditorLanguage } from "./editorLanguages";

export { displayQuestionType as questionTypeName } from "@quorem/contracts/question-type";
export function questionValue(
  value: unknown,
  language: EditorLanguage,
  type?: string,
  context?: NodeContext,
  rowLayout = false,
): string {
  let literalType = type;
  while (literalType?.startsWith("optional<")) literalType = literalType.slice(9, -1);
  const node = literalType ? nodeType(literalType) : undefined;
  if (node && (node.kind !== "ListNode" || (value !== null && !Array.isArray(value)))) {
    try {
      return formatNodeLiteral(literalType!, value as WireValue, context);
    } catch {
      return JSON.stringify(value) ?? "";
    }
  }
  if (value === null)
    return language === "python" || language === "ocaml"
      ? "None"
      : type === "void"
        ? language === "typescript"
          ? "undefined"
          : "void"
        : "null";
  if (typeof value === "boolean")
    return language === "python" ? (value ? "True" : "False") : String(value);
  if (Array.isArray(value)) {
    const collectionType = type?.startsWith("optional<") ? type.slice(9, -1) : type;
    const array = collectionType?.startsWith("array<");
    const inner =
      (collectionType ? nodeType(collectionType)?.payload : undefined) ??
      (collectionType?.startsWith("list<") || array
        ? collectionType!.slice(array ? 6 : 5, -1)
        : undefined);
    const elements = value
      .map((item) => questionValue(item, language, inner))
      .join(language === "ocaml" ? (rowLayout ? ";\n" : "; ") : rowLayout ? ",\n" : ",");
    return language === "ocaml" && array ? `[|${elements}|]` : `[${elements}]`;
  }
  while (type?.startsWith("optional<")) type = type.slice(9, -1);
  if (type === "long" && typeof value === "string") {
    const suffix = { java: "L", typescript: "n", ocaml: "L" } as Partial<
      Record<EditorLanguage, string>
    >;
    return value + (suffix[language] ?? "");
  }
  return JSON.stringify(value) ?? "";
}
