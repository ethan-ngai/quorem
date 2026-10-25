/** @file editorLanguages.ts @description Lazy upstream language adapters and shared editor capabilities. @module editor */
import { ocamlDocumentation } from "./documentationComments";
import { basicCompletion } from "./basicCompletion";
import type { Extension } from "@codemirror/state";
import {
  highlightedPython,
  pythonSupport,
  pythonIdentifierAccents,
  pythonAccentTheme,
} from "./pythonHighlighting";

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
    case "ocaml": {
      const [{ StreamLanguage }, { oCaml }] = await Promise.all([
        import("@codemirror/language"),
        import("@codemirror/legacy-modes/mode/mllike"),
      ]);
      // Wrap the mode's own word list so suggestions also respect literal/comment context.
      const { autocomplete, ...languageData } = oCaml.languageData ?? {};
      const language = StreamLanguage.define({ ...oCaml, languageData });
      return [
        language,
        language.data.of({ documentationComments: ocamlDocumentation }),
        basicCompletion(language, autocomplete as readonly string[]),
      ];
    }
  }
}
export const languageFileNames: Record<EditorLanguage, string> = {
  python: "main.py",
  java: "Solution.java",
  typescript: "main.ts",
  ocaml: "main.ml",
};
