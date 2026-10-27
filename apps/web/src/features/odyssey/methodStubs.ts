import type { OdysseyLevel, Signature } from "@quorem/contracts";
import type { EditorLanguage } from "../editor/editorLanguages";
import { methodDocumentation } from "./methodDocumentation";

import { questionTypeName as typeName } from "../editor/questionTypes";

export function methodStub(method: Signature, language: EditorLanguage, indent = "    "): string {
  const parameters = method.parameters.map(({ name, type }) => {
    const t = typeName(type, language);
    return language === "java"
      ? `${t} ${name}`
      : language === "ocaml"
        ? `(${name} : ${t})`
        : `${name}: ${t}`;
  });
  const result = typeName(method.returnType, language);
  if (language === "python")
    return `${indent}def ${method.methodName}(${["self", ...parameters].join(", ")}) -> ${result}:\n${methodDocumentation(method, language, indent + indent)}${indent}${indent}raise NotImplementedError\n`;
  if (language === "ocaml")
    return `${methodDocumentation(method, language, "")}let ${method.methodName} ${parameters.join(" ") || "()"} : ${result} =\n    failwith "Implement solution"\n`;
  const head =
    language === "java"
      ? `public ${result} ${method.methodName}(${parameters.join(", ")})`
      : `${method.methodName}(${parameters.join(", ")}): ${result}`;
  const error =
    language === "java"
      ? 'new UnsupportedOperationException("Implement solution")'
      : 'new Error("Implement solution")';
  return `${methodDocumentation(method, language, indent)}${indent}${head} {\n${indent}${indent}throw ${error};\n${indent}}\n`;
}

export function initialOdysseySource(
  methods: readonly Signature[],
  language: EditorLanguage,
): string {
  const body = methods.map((method) => methodStub(method, language)).join("\n");
  if (language === "python")
    return `class Solution:\n    def __init__(self):\n        pass\n\n${body}`;
  if (language === "ocaml") return body;
  const constructor = language === "java" ? "public Solution()" : "constructor()";
  return `class Solution {\n    ${constructor} {\n    }\n\n${body}}\n`;
}

/** Insert only missing methods in Solution's parsed body; preserve all existing code and helpers. */
export async function unlockedMethodEdit(
  source: string,
  language: EditorLanguage,
  levels: readonly OdysseyLevel[],
) {
  if (language === "postgresql") return undefined;
  const methods = levels.flatMap((level) => level.methods);
  if (!source.trim())
    return { from: 0, to: source.length, insert: initialOdysseySource(methods, language) };
  if (language === "ocaml") {
    const missing = methods.filter(
      (method) => !new RegExp(`^let\\s+(?:rec\\s+)?${method.methodName}\\b`, "m").test(source),
    );
    return missing.length
      ? {
          from: source.length,
          to: source.length,
          insert: `\n\n${missing.map((method) => methodStub(method, language)).join("\n")}`,
        }
      : undefined;
  }
  const parser =
    language === "python"
      ? (await import("@codemirror/lang-python")).pythonLanguage.parser
      : language === "java"
        ? (await import("@codemirror/lang-java")).javaLanguage.parser
        : (await import("@codemirror/lang-javascript")).typescriptLanguage.parser;
  const tree = parser.parse(source);
  let incomplete = false;
  tree.iterate({
    enter(node) {
      if (node.type.isError) incomplete = true;
    },
  });
  if (incomplete) return undefined;
  const classKind = language === "python" ? "ClassDefinition" : "ClassDeclaration";
  const nameKind =
    language === "python"
      ? "VariableName"
      : language === "java"
        ? "Definition"
        : "VariableDefinition";
  const bodyKind = language === "python" ? "Body" : "ClassBody";
  let edit: { from: number; to: number; insert: string } | undefined;
  tree.iterate({
    enter(node) {
      if (node.name !== classKind) return;
      const name = node.node.getChild(nameKind);
      if (!name || source.slice(name.from, name.to) !== "Solution") return false;
      const body = node.node.getChild(bodyKind);
      if (!body || (language !== "python" && body.lastChild?.name !== "}")) return false;
      let indent = "    ";
      const existing = new Set<string>();
      for (let child = body.firstChild; child; child = child.nextSibling) {
        const method =
          child.name === "DecoratedStatement" ? child.getChild("FunctionDefinition") : child;
        const key = method?.getChild(
          language === "python"
            ? "VariableName"
            : language === "java"
              ? "Definition"
              : "PropertyDefinition",
        );
        if (
          key &&
          (method?.name === "FunctionDefinition" || method?.name === "MethodDeclaration")
        ) {
          existing.add(source.slice(key.from, key.to));
          const prefix = source.slice(source.lastIndexOf("\n", method!.from - 1) + 1, method!.from);
          if (/^[ \t]+$/.test(prefix)) indent = prefix;
        }
      }
      const missing = methods.filter((method) => !existing.has(method.methodName));
      if (missing.length) {
        let from = language === "python" ? node.to : body.to - 1;
        if (language === "python")
          while (from < source.length && /[\r\n\t ]/.test(source[from]!)) from++;
        const prefix = source.slice(0, from);
        const separator = prefix.endsWith("\n\n") ? "" : prefix.endsWith("\n") ? "\n" : "\n\n";
        edit = {
          from,
          to: from,
          insert: `${separator}${missing.map((method) => methodStub(method, language, indent)).join("\n")}${language === "python" && from < source.length ? "\n" : ""}`,
        };
      }
      return false;
    },
  });
  return edit;
}
