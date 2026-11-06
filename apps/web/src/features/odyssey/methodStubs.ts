import { generateStarter, generateMethodStarter } from "@quorem/questions";
import type { OdysseyLevel, Signature } from "@quorem/contracts";
import type { EditorLanguage } from "../editor/editorLanguages";

import { questionTypeName as typeName } from "../editor/questionTypes";

type DeclarationPart = {
  text: string;
  role: "keyword" | "type" | "parameter" | "function" | "operator";
};

export function methodDeclarationParts(
  method: Signature,
  language: EditorLanguage,
): DeclarationPart[] {
  const parts: DeclarationPart[] = [];
  const add = (text: string, role: DeclarationPart["role"] = "operator") =>
    parts.push({ text, role });

  if (language === "java") {
    add("public", "keyword");
    add(" ");
    add(typeName(method.returnType, language), "type");
    add(" ");
  } else if (language === "python" || language === "ocaml") {
    add(language === "python" ? "def" : "let", "keyword");
    add(" ");
  }
  add(method.methodName, "function");
  if (language === "ocaml") add(method.parameters.length ? " " : " ()");
  else add("(");
  if (language === "python") {
    add("self", "parameter");
    if (method.parameters.length) add(", ");
  }
  method.parameters.forEach(({ name, type }, index) => {
    if (index > 0) add(language === "ocaml" ? " " : ", ");
    if (language === "java") {
      add(typeName(type, language), "type");
      add(" ");
      add(name, "parameter");
    } else {
      if (language === "ocaml") add("(");
      add(name, "parameter");
      add(language === "ocaml" ? " : " : ": ");
      add(typeName(type, language), "type");
      if (language === "ocaml") add(")");
    }
  });
  if (language !== "ocaml") add(")");
  if (language !== "java") {
    add(language === "python" ? " -> " : language === "ocaml" ? " : " : ": ");
    add(typeName(method.returnType, language), "type");
    if (language === "ocaml") add(" =");
    if (language === "python") add(":");
  }
  return parts;
}

export function methodStub(method: Signature, language: EditorLanguage, indent = "    "): string {
  if (language === "postgresql") return "-- Write your query here.\n";
  return generateMethodStarter(method, language, true).replace(/^((?: {4})+)/gm, (spaces) =>
    indent.repeat(spaces.length / 4),
  );
}

export function initialOdysseySource(
  methods: readonly Signature[],
  language: EditorLanguage,
): string {
  return generateStarter(methods, language, true);
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
