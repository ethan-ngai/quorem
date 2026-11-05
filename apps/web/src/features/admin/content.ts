/** @file content.ts @description Initial draft and pinned language configuration. @module admin */
import type { QuestionContent } from "@quorem/contracts";
import { blankApproach } from "@quorem/questions";
export const revisions = {
  python: ["python-3.12-v1", "quorem-harness-v2"],
  java: ["java-21.0.9-v1", "quorem-java-v1"],
  typescript: ["typescript-5.9.3-node-22.21.1-v1", "quorem-typescript-v1"],
  ocaml: ["ocaml-4.13.1-v1", "quorem-ocaml-v1"],
  postgresql: ["postgresql-17.6-v1", "quorem-postgresql-v2"],
} as const;
export type Language = keyof typeof revisions;
/** Starter/runtime registration is independent of editorial availability. */
export function languageImplementation(
  language: Language,
): QuestionContent["implementations"][number] {
  return {
    language,
    starterSource: "",
    runtimeRevision: revisions[language][0],
    harnessRevision: revisions[language][1],
  };
}
export function questionImplementations(sql = false): QuestionContent["implementations"] {
  return (Object.keys(revisions) as Language[])
    .filter((language) => (sql ? language === "postgresql" : language !== "postgresql"))
    .map(languageImplementation);
}
/** @returns An incomplete draft; publication performs authoritative validation. */
export function blankQuestion(): QuestionContent {
  return {
    problem: {
      id: "00000000-0000-4000-8000-000000000000",
      slug: "",
      version: "1",
      title: "",
      difficulty: "easy",
      tags: [],
      statementMarkdown: "",
      examples: [],
      constraints: [],
      signature: { className: "Solution", methodName: "solve", parameters: [], returnType: "int" },
      limits: {
        wallTimeMs: 2000,
        memoryBytes: 268435456,
        outputBytes: 65536,
        maxProcesses: 16,
        maxCollectionElements: 10000,
        maxNestingDepth: 100,
      },
    },
    hiddenCases: [],
    attribution: "Original Quorem question.",
    implementations: questionImplementations(),
    canonicalApproachId: "default",
    approaches: [blankApproach()],
  };
}
