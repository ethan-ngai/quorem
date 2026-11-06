/** @file runtime.ts @description Derived question language and starter projections. @module problems */
import {
  generateQuestionImplementations,
  type JsonValue,
  type QuestionProblem,
  supportsQuestionLanguage,
} from "@quorem/questions";
import { languageRuntime } from "@quorem/execution";
import { ApplicationError } from "../../../application/error.ts";
type Obj = { [key: string]: JsonValue };

/** Runtime pins belong to admitted executions, never to question configuration. */
export function questionRuntime(language: string, sql: boolean) {
  const runtime = supportsQuestionLanguage(language, sql) ? languageRuntime(language) : undefined;
  if (!runtime)
    throw new ApplicationError("invalid_input", "Language unavailable for this question", 400);
  return runtime;
}

/** Generate transport fields from authorized signature/stage metadata at read time. */
export function projectQuestionRuntime(problem: Obj, language?: string): void {
  const implementations = generateQuestionImplementations(
    problem as unknown as QuestionProblem,
    languageRuntime,
  );
  const selected = implementations.find(
    (item) => item.language === (language ?? (problem.sql ? "postgresql" : "python")),
  );
  if (!selected)
    throw new ApplicationError("invalid_input", "Language unavailable for this question", 400);
  problem.languages = implementations;
  problem.starterSource = selected.starterSource;
  problem.runtimeRevision = selected.runtimeRevision;
}
