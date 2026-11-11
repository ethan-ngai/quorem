/** @file questionFixture.ts @description Public problem fixtures derive transport-only runtime metadata. @module test */
import type { QuestionContent, PublishedQuestion } from "@quorem/contracts";
import { generateQuestionImplementations, publicQuestionProblem } from "@quorem/questions";
export function publicQuestionFixture(value: unknown): PublishedQuestion {
  const content = value as QuestionContent;
  const languages = generateQuestionImplementations(content.problem, () => ({
    revision: "fixture-runtime",
    harness: "fixture-harness",
  }));
  const selected = languages[0];
  return {
    ...publicQuestionProblem(content.problem),
    languages,
    starterSource: selected.starterSource,
    runtimeRevision: selected.runtimeRevision,
  } as PublishedQuestion;
}
