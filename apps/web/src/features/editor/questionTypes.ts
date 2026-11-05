import { javaQuestionType } from "@quorem/contracts/java-type";
import { nodeType } from "@quorem/contracts/node-type";
import type { EditorLanguage } from "./editorLanguages";

/** Wire types stay language-neutral; only presentation and generated source use these spellings. */
export function questionTypeName(type: string, language: EditorLanguage): string {
  if (language === "java") return javaQuestionType(type) ?? type;
  const node = nodeType(type);
  if (node?.generic) {
    const inner = questionTypeName(node.payload, language);
    if (language === "python") return `${node.kind}[${inner}]`;
    if (language === "ocaml")
      return `${inner} ${node.kind === "ListNode" ? "typed_list_node" : "typed_tree_node"} option`;
    return `${node.kind}<${inner}> | null`;
  }
  if (type.startsWith("optional<")) {
    let payload = type.slice(9, -1);
    while (payload.startsWith("optional<")) payload = payload.slice(9, -1);
    const inner = questionTypeName(payload, language);
    if (language === "python") return `${inner} | None`;
    if (language === "typescript") return inner.endsWith(" | null") ? inner : `${inner} | null`;
    if (language === "ocaml") return `(${inner}) option`;
    return inner;
  }
  const array = type.startsWith("array<");
  if (array || type.startsWith("list<")) {
    const inner = questionTypeName(type.slice(array ? 6 : 5, -1), language);
    if (language === "python") return `list[${inner}]`;
    if (language === "ocaml") return `(${inner}) ${array ? "array" : "list"}`;
    return `(${inner})[]`.replace(/^\((\w+)\)/, "$1");
  }
  const names: Record<Exclude<EditorLanguage, "java">, Record<string, string>> = {
    python: {
      void: "None",
      int: "int",
      long: "int",
      float: "float",
      bool: "bool",
      str: "str",
      datetime: "datetime.datetime",
    },
    typescript: {
      void: "void",
      int: "number",
      long: "bigint",
      float: "number",
      bool: "boolean",
      str: "string",
      datetime: "Date",
      ListNode: "ListNode | null",
      TreeNode: "TreeNode | null",
    },
    postgresql: {},
    ocaml: {
      void: "unit",
      int: "int",
      long: "int64",
      float: "float",
      bool: "bool",
      str: "string",
      datetime: "Unix.tm",
      ListNode: "list_node option",
      TreeNode: "tree_node option",
    },
  };
  return names[language][type] ?? type;
}
export function questionValue(value: unknown, language: EditorLanguage, type?: string): string {
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
      .join(language === "ocaml" ? "; " : ",");
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
