/** @file typeScriptSemanticTokens.ts @description Adapter from TypeScript compiler classifications to shared semantic roles. @module editor */
import { createWorker } from "@valtown/codemirror-ts/worker";
import ts from "typescript";
import type { SemanticRequest, SemanticRole, SemanticToken } from "./semanticHighlighting";

// TypeScript's public 2020 classification format, also consumed by VS Code.
const classificationRoles: readonly SemanticRole[] = [
  "class",
  "class",
  "class",
  "class",
  "class",
  "class",
  "parameter",
  "foreground",
  "number",
  "parameter",
  "function",
  "function",
];

/** @returns The existing compiler worker plus semantic classifications; no second parser or compiler instance. */
export function createTypeScriptWorker(initializer: Parameters<typeof createWorker>[0]) {
  const worker = createWorker(initializer);
  return {
    ...worker,
    getDocumentationTemplate({
      path,
      source,
      position,
    }: {
      path: string;
      source: string;
      position: number;
    }) {
      const environment = worker.getEnv();
      if (!environment || environment.getSourceFile(path)?.text !== source) return null;
      return (
        environment.languageService.getDocCommentTemplateAtPosition(path, position, {
          generateReturnInDocTemplate: true,
        }) ?? null
      );
    },
    getSemanticTokens({
      path,
      source,
      ranges,
    }: SemanticRequest & { path: string }): SemanticToken[] {
      const environment = worker.getEnv();
      // The sync extension owns source updates; late requests must never overwrite newer edits.
      if (!environment || environment.getSourceFile(path)?.text !== source) return [];
      const tokens: SemanticToken[] = [];
      for (const range of ranges) {
        const { spans } = environment.languageService.getEncodedSemanticClassifications(
          path,
          { start: range.from, length: range.to - range.from },
          ts.SemanticClassificationFormat.TwentyTwenty,
        );
        for (let index = 0; index < spans.length; index += 3) {
          const [from, length, encoded] = spans.slice(index, index + 3);
          const role = classificationRoles[(encoded >> 8) - 1];
          if (!role) continue;
          const defaultLibrary = (encoded & 16) !== 0;
          tokens.push({ from, to: from + length, role: defaultLibrary ? "builtin" : role });
        }
      }
      return tokens;
    },
  };
}

export type BrowserTypeScriptWorker = ReturnType<typeof createTypeScriptWorker>;
