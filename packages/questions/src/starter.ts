/** @file starter.ts @description Generate initial method source. @module questions */
import { primarySignature } from "./signature.ts";
import { sourceQuestionType as languageType } from "@quorem/contracts/question-type";
import type { QuestionProblem, Signature } from "./model.ts";
import type { components } from "@quorem/contracts/schema";
import type { RuntimeResolver } from "./publication.ts";

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

/** Generate one method stub; shared by initial source and incremental stage unlocking. */
export function generateMethodStarter(
  sig: Signature,
  language: Exclude<StarterLanguage, "postgresql">,
  staged: boolean,
): string {
  if (language === "python")
    return `    def ${sig.methodName}(${["self", ...sig.parameters.map((p) => `${p.name}: ${languageType(p.type, language)}`)].join(", ")}) -> ${languageType(sig.returnType, language)}:\n${documentation(sig, language, "        ")}        raise NotImplementedError\n`;
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
    return `${documentation(sig, language, "    ")}    public ${result} ${sig.methodName}(${params.join(", ")}) {\n        throw new UnsupportedOperationException("Implement solution");\n    }\n`;
  if (language === "typescript")
    return `${documentation(sig, language, "    ")}    ${sig.methodName}(${params.join(", ")}): ${result} {\n        throw new Error("Implement solution");\n    }\n`;
  const args = staged && !params.length ? "()" : params.join(" ");
  const node = [...sig.parameters.map((p) => p.type), sig.returnType].some((t) =>
    t.includes("Node"),
  );
  const note = node
    ? "(* Judge supplies mutable list_node, tree_node and nary_tree_node records. *)\n"
    : "";
  return `${note}${documentation(sig, language, "")}let ${sig.methodName} ${args} : ${result} =\n    failwith "Implement solution"\n`;
}

/** Generate a source document for a classic or staged question. */
export function generateStarter(
  methods: readonly Signature[],
  language: StarterLanguage,
  staged: boolean,
): string {
  if (language === "postgresql") return "-- Write your query here.\n";
  if (!methods.length) throw new Error("method required");
  if (!staged) {
    const sig = methods[0];
    const body = generateMethodStarter(sig, language, false);
    if (language === "ocaml") return body;
    const node =
      language !== "python" &&
      [...sig.parameters.map((p) => p.type), sig.returnType].some((t) => t.includes("Node"));
    const note = node ? "// Judge supplies ListNode, TreeNode and NaryTreeNode.\n" : "";
    return `${note}class ${sig.className}${language === "python" ? ":" : " {"}\n${body}${language === "python" ? "" : "}\n"}`;
  }
  const bodies = methods.map((sig) => generateMethodStarter(sig, language, true));
  if (language === "ocaml") return bodies.join("\n");
  if (language === "python")
    return `class Solution:\n    def __init__(self) -> None:\n        pass\n\n${bodies.join("\n")}`;
  return `class Solution {\n${language === "java" ? "    public Solution() {" : "    constructor() {"}\n    }\n\n${bodies.join("\n")}}\n`;
}

/** Derive executable languages from the signature, independently of editorial code variants. */
export function generateQuestionImplementations(
  problem: Pick<QuestionProblem, "signature" | "sql" | "odyssey">,
  resolveRuntime: RuntimeResolver,
): components["schemas"]["LanguageImplementation"][] {
  const languages = questionLanguages(!!problem.sql);
  const methods = problem.sql
    ? []
    : problem.odyssey
      ? problem.odyssey.levels[0].methods
      : [primarySignature(problem)];
  return languages.map((language) => {
    const runtime = resolveRuntime(language);
    if (!runtime) throw new Error(`Missing supported runtime: ${language}`);
    return {
      language,
      starterSource: generateStarter(methods, language, !!problem.odyssey),
      runtimeRevision: runtime.revision,
      harnessRevision: runtime.harness,
    };
  });
}

/** Supported languages depend only on whether a question uses SQL. */
export function questionLanguages(sql: boolean): readonly StarterLanguage[] {
  return sql ? ["postgresql"] : ["python", "java", "typescript", "ocaml"];
}

/** Check platform support without consulting per-question registrations. */
export function supportsQuestionLanguage(
  language: string,
  sql: boolean,
): language is StarterLanguage {
  return questionLanguages(sql).some((candidate) => candidate === language);
}
