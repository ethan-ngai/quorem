/** @file projection.ts @description Public question metadata derived from authored owners. @module questions */
import type { QuestionProblem } from "@quorem/contracts";
import type { QuestionContent } from "./model.ts";
import { primarySignature } from "./signature.ts";

/** Strip private stage cases; materialize the coding interface from its authored owner. */
export function publicQuestionProblem(problem: QuestionContent["problem"]): QuestionProblem {
  const { signature: _signature, acceptance: _acceptance, odyssey, ...metadata } = problem;
  return {
    ...metadata,
    ...(!problem.sql ? { signature: primarySignature(problem) } : {}),
    ...(odyssey
      ? {
          odyssey: {
            levels: odyssey.levels.map(({ title, statementMarkdown, methods, examples }) => ({
              title,
              statementMarkdown,
              methods,
              examples,
            })),
          },
        }
      : {}),
  };
}
