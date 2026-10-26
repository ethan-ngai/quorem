import type { EditorLanguage } from "./editorLanguages";

/** Wire types stay language-neutral; only presentation and generated source use these spellings. */
export function questionTypeName(type: string, language: EditorLanguage): string {
  if (type.startsWith("optional<")) {
    const inner = questionTypeName(type.slice(9, -1), language);
    if (language === "python") return `${inner} | None`;
    if (language === "typescript") return `${inner} | null`;
    if (language === "ocaml") return `(${inner}) option`;
    return boxJava(inner);
  }
  const array = type.startsWith("array<");
  if (array || type.startsWith("list<")) {
    const inner = questionTypeName(type.slice(array ? 6 : 5, -1), language);
    if (language === "python") return `list[${inner}]`;
    if (language === "java") return array ? `${inner}[]` : `java.util.List<${boxJava(inner)}>`;
    if (language === "ocaml") return `(${inner}) ${array ? "array" : "list"}`;
    return `(${inner})[]`.replace(/^\((\w+)\)/, "$1");
  }
  const names: Record<EditorLanguage, Record<string, string>> = {
    python: { void: "None", int: "int", float: "float", bool: "bool", str: "str" },
    java: { void: "void", int: "int", float: "double", bool: "boolean", str: "String" },
    typescript: { void: "void", int: "number", float: "number", bool: "boolean", str: "string" },
    postgresql: {},
    ocaml: { void: "unit", int: "int", float: "float", bool: "bool", str: "string" },
  };
  return names[language][type] ?? type;
}
function boxJava(type: string) {
  return (
    ({ int: "Integer", double: "Double", boolean: "Boolean" } as Record<string, string>)[type] ??
    type
  );
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
      collectionType?.startsWith("list<") || array
        ? collectionType!.slice(array ? 6 : 5, -1)
        : undefined;
    const elements = value
      .map((item) => questionValue(item, language, inner))
      .join(language === "ocaml" ? "; " : ",");
    return language === "ocaml" && array ? `[|${elements}|]` : `[${elements}]`;
  }
  return JSON.stringify(value) ?? "";
}
