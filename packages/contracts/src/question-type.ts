/** @file question-type.ts @description Question type display and source rendering. @module contracts */
import { javaQuestionType } from "./java-type.ts";
import { nodeType, ocamlNodeNames } from "./node-type.ts";

export type QuestionLanguage = "python" | "java" | "typescript" | "ocaml" | "postgresql";

const names: Record<Exclude<QuestionLanguage, "java">, Record<string, string>> = {
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

function wrapper(type: string) {
  for (const name of ["optional", "array", "list"] as const)
    if (type.startsWith(`${name}<`)) return { name, inner: type.slice(name.length + 1, -1) };
  return undefined;
}

/** Layout applies to two-dimensional arrays, including nullable arrays and rows. */
export function isMatrixType(type: string): boolean {
  const unwrap = (value: string) => {
    while (value.startsWith("optional<")) value = value.slice(9, -1);
    return value;
  };
  const outer = wrapper(unwrap(type));
  const inner = outer && wrapper(unwrap(outer.inner));
  return !!inner && !wrapper(unwrap(inner.inner));
}

function genericNode(type: string) {
  const node = nodeType(type);
  return node && (node.generic || node.kind === "NaryTreeNode") ? node : undefined;
}

/** Wire types stay language-neutral; only presentation and generated source use these spellings. */
export function displayQuestionType(type: string, language: QuestionLanguage): string {
  if (language === "java") return javaQuestionType(type) ?? type;
  const node = genericNode(type);
  if (node) {
    const inner = displayQuestionType(node.payload, language);
    if (language === "python") return `${node.kind}[${inner}]`;
    if (language === "ocaml") return `${inner} ${ocamlNodeNames[node.kind]} option`;
    return `${node.kind}<${inner}> | null`;
  }
  const wrapped = wrapper(type);
  if (wrapped?.name === "optional") {
    let payload = wrapped.inner;
    while (payload.startsWith("optional<")) payload = payload.slice(9, -1);
    const inner = displayQuestionType(payload, language);
    if (language === "python") return `${inner} | None`;
    if (language === "typescript") return inner.endsWith(" | null") ? inner : `${inner} | null`;
    if (language === "ocaml") return `(${inner}) option`;
    return inner;
  }
  if (wrapped) {
    const array = wrapped.name === "array";
    const inner = displayQuestionType(wrapped.inner, language);
    if (language === "python") return `list[${inner}]`;
    if (language === "ocaml") return `(${inner}) ${array ? "array" : "list"}`;
    return `(${inner})[]`.replace(/^\((\w+)\)/, "$1");
  }
  return names[language][type] ?? type;
}

/** Render source types without display-only normalization. */
export function sourceQuestionType(
  kind: string,
  language: "python" | "java" | "typescript" | "ocaml",
): string {
  if (language === "java") {
    const type = javaQuestionType(kind);
    if (!type) throw new Error(`unsupported type ${kind} for ${language}`);
    return type;
  }
  if (language === "python") {
    const node = nodeType(kind);
    if (node) return `${node.kind}[${sourceQuestionType(node.payload, language)}] | None`;
    const wrapped = wrapper(kind);
    if (wrapped && kind.endsWith(">")) {
      const inner = sourceQuestionType(wrapped.inner, language);
      return wrapped.name === "optional"
        ? inner.endsWith(" | None")
          ? inner
          : `${inner} | None`
        : `list[${inner}]`;
    }
    const value = names.python[kind];
    if (value === undefined) throw new Error(`unsupported type ${kind} for ${language}`);
    return value;
  }
  const node = genericNode(kind);
  if (node) {
    const inner = sourceQuestionType(node.payload, language);
    return language === "typescript"
      ? `${node.kind}<${inner}> | null`
      : `${inner} ${ocamlNodeNames[node.kind]} option`;
  }
  const wrapped = wrapper(kind);
  if (wrapped && kind.endsWith(">")) {
    const inner = sourceQuestionType(wrapped.inner, language);
    if (language === "typescript")
      return wrapped.name === "optional" ? `${inner} | null` : `(${inner})[]`;
    return `(${inner}) ${wrapped.name === "optional" ? "option" : wrapped.name}`;
  }
  const value = names[language][kind];
  if (value === undefined) throw new Error(`unsupported type ${kind} for ${language}`);
  return value;
}
