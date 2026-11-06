/** @file content.ts @description Initial authored question content. @module admin */
import type { QuestionContent } from "@quorem/contracts";
import { blankApproach, blankSignature } from "@quorem/questions";
export type Language = import("@quorem/questions").StarterLanguage;
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
      signature: blankSignature(),
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
    canonicalApproachId: "default",
    approaches: [blankApproach()],
  };
}
