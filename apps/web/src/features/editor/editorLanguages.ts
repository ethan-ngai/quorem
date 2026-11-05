/** @file editorLanguages.ts @description Lazy upstream language adapters and shared editor capabilities. @module editor */
import type { Extension } from "@codemirror/state";
import {
  highlightedPython,
  pythonSupport,
  pythonIdentifierAccents,
  pythonAccentTheme,
} from "./pythonHighlighting";

export type EditorLanguage = "python" | "java" | "typescript" | "ocaml" | "postgresql";
export const languageLabels: Record<EditorLanguage, string> = {
  python: "Python",
  java: "Java",
  typescript: "TypeScript",
  ocaml: "OCaml",
  postgresql: "PostgreSQL",
};
export function solutionLanguageLabel(language: EditorLanguage): string {
  return language === "postgresql" ? "SQL" : languageLabels[language];
}
export const pythonExtensions: Extension = [
  highlightedPython,
  pythonSupport,
  pythonIdentifierAccents,
  pythonAccentTheme,
];

/** Load each grammar only when its document opens. */
export async function loadLanguageExtensions(language: EditorLanguage): Promise<Extension> {
  switch (language) {
    case "python":
      return pythonExtensions;
    case "java":
      return (await import("./javaHighlighting")).javaExtensions;
    case "typescript":
      return (await import("./typescriptHighlighting")).typescriptExtensions;
    case "postgresql":
      return (await import("./postgresqlHighlighting")).postgresqlExtensions;
    case "ocaml":
      return (await import("./ocamlHighlighting")).ocamlExtensions;
  }
}
export const languageFileNames: Record<EditorLanguage, string> = {
  python: "main.py",
  java: "Solution.java",
  typescript: "main.ts",
  ocaml: "main.ml",
  postgresql: "query.sql",
};
