import type { Signature } from "@quorem/contracts";
import type { EditorLanguage } from "../editor/editorLanguages";

/** Render author-provided prose as safe language-native method documentation. */
export function methodDocumentation(
  method: Signature,
  language: EditorLanguage,
  indent: string,
): string {
  const { description = "", parameters, returns = "", throws = [] } = method;
  const describedParams = parameters.filter((parameter) => parameter.description?.trim());
  const exceptions = throws.filter((item) => item.type.trim() || item.description.trim());
  if (!description.trim() && !describedParams.length && !returns.trim() && !exceptions.length)
    return "";
  const clean = (text: string) => text.replace(/\0/g, "").replace(/\r\n?/g, "\n").trim();
  if (language === "python") {
    const lines = clean(description)
      .split("\n")
      .filter((line, i) => i > 0 || line);
    if (describedParams.length) {
      if (lines.length) lines.push("");
      lines.push("Args:");
      for (const parameter of describedParams)
        lines.push(
          `    ${parameter.name}: ${clean(parameter.description!).replace(/\n/g, "\n        ")}`,
        );
    }
    if (returns.trim()) {
      if (lines.length) lines.push("");
      lines.push("Returns:", `    ${clean(returns).replace(/\n/g, "\n    ")}`);
    }
    if (exceptions.length) {
      if (lines.length) lines.push("");
      lines.push("Raises:");
      for (const exception of exceptions)
        lines.push(
          `    ${clean(exception.type)}: ${clean(exception.description).replace(/\n/g, "\n        ")}`,
        );
    }
    const escaped = lines.map((line) => line.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"'));
    return `${indent}"""${escaped.join(`\n${indent}`)}\n${indent}"""\n`;
  }
  const lines = clean(description)
    .split("\n")
    .filter((line, i) => i > 0 || line);
  const tag = (name: string, text: string) =>
    lines.push(`@${name} ${clean(text).replace(/\n/g, " ")}`.trimEnd());
  for (const parameter of describedParams)
    tag("param", `${parameter.name} ${parameter.description}`);
  if (returns.trim()) tag(language === "typescript" ? "returns" : "return", returns);
  for (const exception of exceptions)
    tag(language === "ocaml" ? "raise" : "throws", `${exception.type} ${exception.description}`);
  if (language === "ocaml")
    return `(** ${lines.map((line) => line.replace(/\(\*/g, "( *").replace(/\*\)/g, "* )").replace(/"/g, "”")).join("\n    ")} *)\n`;
  return `${indent}/**\n${lines.map((line) => `${indent} * ${line.replace(/\*\//g, "* /")}`).join("\n")}\n${indent} */\n`;
}
