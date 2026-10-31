/** @file starter.ts @description Generate initial method source. @module questions */
import type { Signature } from "./model";

export type StarterLanguage = "python" | "java" | "typescript" | "ocaml" | "postgresql";

function documentation(sig: Signature, language: StarterLanguage, indent: string): string {
  const lines: string[] = [];
  const add = (text: string) =>
    lines.push(...text.replaceAll("\0", "").replace(/\n+$/, "").split("\n"));
  if (sig.description?.trim()) add(sig.description);
  const throws = (sig.throws ?? []).filter((t) => t.type.trim() || t.description.trim());
  if (language === "python") {
    const params = sig.parameters.filter((p) => p.description?.trim());
    if (params.length) {
      if (lines.length) lines.push("");
      lines.push("Args:");
      for (const p of params) add(`    ${p.name}: ${p.description}`);
    }
    if (sig.returns?.trim()) {
      if (lines.length) lines.push("");
      lines.push("Returns:");
      add(`    ${sig.returns}`);
    }
    if (throws.length) {
      if (lines.length) lines.push("");
      lines.push("Raises:");
      for (const t of throws) add(`    ${t.type}: ${t.description}`);
    }
    if (!lines.length) return "";
    return `${indent}"""\n${indent}${lines.map((l) => l.replaceAll("\\", "\\\\").replaceAll('"""', '\\"\\"\\"')).join(`\n${indent}`)}\n${indent}"""\n`;
  }
  for (const p of sig.parameters)
    if (p.description?.trim()) add(`@param ${p.name} ${p.description}`);
  if (sig.returns?.trim())
    add(`@${language === "typescript" ? "returns" : "return"} ${sig.returns}`);
  for (const t of throws)
    add(`@${language === "ocaml" ? "raise" : "throws"} ${t.type} ${t.description}`);
  if (!lines.length) return "";
  if (language === "ocaml")
    return `${indent}(**\n${indent}   ${lines.map((l) => l.replaceAll("*)", "* )").replaceAll("(*", "( *").replaceAll('"', "”")).join(`\n${indent}   `)}\n${indent} *)\n`;
  return `${indent}/**\n${indent} * ${lines.map((l) => l.replaceAll("*/", "* /")).join(`\n${indent} * `)}\n${indent} */\n`;
}

function languageType(
  kind: string,
  language: Exclude<StarterLanguage, "python" | "postgresql">,
): string {
  for (const wrapper of ["optional", "array", "list"] as const) {
    if (kind.startsWith(`${wrapper}<`) && kind.endsWith(">")) {
      let inner = languageType(kind.slice(wrapper.length + 1, -1), language);
      if (language === "java") {
        if (wrapper !== "array")
          inner =
            ({ int: "Integer", double: "Double", boolean: "Boolean" } as Record<string, string>)[
              inner
            ] ?? inner;
        return wrapper === "optional"
          ? inner
          : wrapper === "array"
            ? `${inner}[]`
            : `java.util.List<${inner}>`;
      }
      if (language === "typescript")
        return wrapper === "optional" ? `${inner} | null` : `(${inner})[]`;
      return `(${inner}) ${wrapper === "optional" ? "option" : wrapper}`;
    }
  }
  const types: Record<string, Record<string, string>> = {
    java: {
      void: "void",
      int: "int",
      float: "double",
      bool: "boolean",
      str: "String",
      datetime: "java.time.LocalDateTime",
      ListNode: "ListNode",
      TreeNode: "TreeNode",
    },
    typescript: {
      void: "void",
      int: "number",
      float: "number",
      bool: "boolean",
      str: "string",
      datetime: "Date",
      ListNode: "ListNode | null",
      TreeNode: "TreeNode | null",
    },
    ocaml: {
      void: "unit",
      int: "int",
      float: "float",
      bool: "bool",
      str: "string",
      datetime: "Unix.tm",
      ListNode: "list_node option",
      TreeNode: "tree_node option",
    },
  };
  const value = types[language][kind];
  if (!value) throw new Error(`unsupported type ${kind} for ${language}`);
  return value;
}

function starter(sig: Signature, language: Exclude<StarterLanguage, "postgresql">): string {
  if (language === "python")
    return `class ${sig.className}:\n    def ${sig.methodName}(${["self", ...sig.parameters.map((p) => p.name)].join(", ")}):\n${documentation(sig, language, "        ")}        raise NotImplementedError\n`;
  const node = [...sig.parameters.map((p) => p.type), sig.returnType].some((t) =>
    t.includes("Node"),
  );
  const note = !node
    ? ""
    : language === "ocaml"
      ? "(* Judge supplies mutable list_node {value:int; next:list_node option} and tree_node {value:int; left:tree_node option; right:tree_node option}. *)\n"
      : "// Judge supplies ListNode(val, next) and TreeNode(val, left, right).\n";
  const result = languageType(sig.returnType, language);
  const params = sig.parameters.map((p) => {
    const t = languageType(p.type, language);
    return language === "java"
      ? `${t} ${p.name}`
      : language === "typescript"
        ? `${p.name}: ${t}`
        : `(${p.name}:${t})`;
  });
  if (language === "java")
    return `${note}class ${sig.className} {\n${documentation(sig, language, "    ")}    public ${result} ${sig.methodName}(${params.join(", ")}) {\n        throw new UnsupportedOperationException("Implement solution");\n    }\n}\n`;
  if (language === "typescript")
    return `${note}class ${sig.className} {\n${documentation(sig, language, "    ")}    ${sig.methodName}(${params.join(", ")}): ${result} {\n        throw new Error("Implement solution");\n    }\n}\n`;
  return `${note}${documentation(sig, language, "")}let ${sig.methodName} ${params.join(" ")} : ${result} =\n    failwith "Implement solution"\n`;
}

/** Generate a source document for a classic or staged question. */
export function generateStarter(
  methods: readonly Signature[],
  language: StarterLanguage,
  staged: boolean,
): string {
  if (language === "postgresql") return "-- Write your query here.\n";
  if (!methods.length) throw new Error("method required");
  if (!staged) return starter(methods[0], language);
  const bodies = methods.map((sig) => {
    let source = starter(sig, language);
    if (language === "ocaml")
      return sig.parameters.length
        ? source
        : source.replace(`let ${sig.methodName}  :`, `let ${sig.methodName} () :`);
    const marker = `class ${sig.className}${language === "python" ? ":" : " {"}\n`;
    const offset = source.indexOf(marker);
    if (offset < 0) throw new Error("unsupported stage starter");
    source = source.slice(offset + marker.length);
    return language === "python" ? source : source.replace(/}\n$/, "");
  });
  if (language === "ocaml") return bodies.join("\n");
  if (language === "python")
    return `class Solution:\n    def __init__(self):\n        pass\n\n${bodies.join("\n")}`;
  return `class Solution {\n${language === "java" ? "    public Solution() {" : "    constructor() {"}\n    }\n\n${bodies.join("\n")}}\n`;
}
