import { basicCompletion, javaKeywords } from "./basicCompletion";
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
    case "java": {
      const { java, javaLanguage } = await import("@codemirror/lang-java");
      return [java(), basicCompletion(javaLanguage, javaKeywords)];
    }
    case "typescript":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true });
    case "ocaml": {
      const [{ StreamLanguage }, { oCaml }] = await Promise.all([
        import("@codemirror/language"),
        import("@codemirror/legacy-modes/mode/mllike"),
      ]);
      // Wrap the mode's own word list so suggestions also respect literal/comment context.
      const { autocomplete, ...languageData } = oCaml.languageData ?? {};
      const language = StreamLanguage.define({ ...oCaml, languageData });
      return [language, basicCompletion(language, autocomplete as readonly string[])];
    }
  }
}
export const languageFileNames: Record<EditorLanguage, string> = {
  python: "main.py",
  java: "Solution.java",
  typescript: "main.ts",
  ocaml: "main.ml",
};
