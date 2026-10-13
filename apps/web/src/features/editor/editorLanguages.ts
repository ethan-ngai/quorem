import type { Extension } from "@codemirror/state";
import { highlightedPython, pythonSupport, pythonIdentifierAccents } from "./pythonHighlighting";

export type EditorLanguage = "python" | "java" | "typescript" | "ocaml";
export const languageLabels: Record<EditorLanguage, string> = {
  python: "Python",
  java: "Java",
  typescript: "TypeScript",
  ocaml: "OCaml",
};
export const pythonExtensions: Extension = [
  highlightedPython,
  pythonSupport,
  pythonIdentifierAccents,
];

/** Load each grammar only when its document opens. */
export async function loadLanguageExtensions(language: EditorLanguage): Promise<Extension> {
  switch (language) {
    case "python":
      return pythonExtensions;
    case "java":
      return (await import("@codemirror/lang-java")).java();
    case "typescript":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true });
    case "ocaml": {
      const [{ StreamLanguage }, { oCaml }] = await Promise.all([
        import("@codemirror/language"),
        import("@codemirror/legacy-modes/mode/mllike"),
      ]);
      return StreamLanguage.define(oCaml);
    }
  }
}
export const languageFileNames: Record<EditorLanguage, string> = {
  python: "main.py",
  java: "Solution.java",
  typescript: "main.ts",
  ocaml: "main.ml",
};
