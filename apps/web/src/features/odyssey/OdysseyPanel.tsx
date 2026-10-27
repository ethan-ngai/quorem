/** @file OdysseyPanel.tsx @description Authorized levels composed into the shared problem statement. @module odyssey */
import { useQuestionLanguage } from "../editor/QuestionLanguage";
import { questionTypeName } from "../editor/questionTypes";
import { type ReactNode } from "react";
import type { OdysseyProgress } from "@quorem/contracts";
import { ProblemStatement, type StatementProblem } from "../editor/components/ProblemStatement";
import { StatementMarkdown } from "../editor/components/StatementMarkdown";

/** Level selection changes prose only; the mounted editor and its source stay independent. */
export function OdysseyPanel({
  progress,
  problem,
  title,
  introduction,
  children,
  selectedLevel,
  allowTopics = true,
}: {
  progress: OdysseyProgress;
  problem?: StatementProblem;
  title?: string;
  introduction?: string;
  children?: ReactNode;
  selectedLevel?: number;
  allowTopics?: boolean;
}) {
  const language = useQuestionLanguage();
  const index = Math.min((selectedLevel ?? progress.level) - 1, progress.levels.length - 1);
  const level = progress.levels[index];
  if (!level) return null;
  const statement: StatementProblem = {
    id: problem?.id ?? "odyssey",
    title: problem?.title ?? title ?? level.title,
    difficulty: problem?.difficulty ?? "easy",
    tags: problem?.tags ?? [],
    signature: level.methods[0] ?? problem!.signature,
    sql: problem?.sql,
    constraints: [],
    examples: level.examples,
    odyssey: { levels: progress.levels },
    statementMarkdown: level.statementMarkdown,
  };
  return (
    <ProblemStatement
      problem={statement}
      allowTopics={allowTopics}
      navigation={
        <>
          {(problem?.statementMarkdown ?? introduction) && (
            <div className="problem-copy">
              <StatementMarkdown source={problem?.statementMarkdown ?? introduction!} />
            </div>
          )}
          <section className="problem-section">
            <h2>{level.title}</h2>
          </section>
        </>
      }
      beforeExamples={
        !problem?.sql && (
          <section className="problem-section problem-copy">
            <h2>Methods to implement</h2>
            {level.methods.map((method) => (
              <p key={method.methodName}>
                <code>
                  {method.className}.{method.methodName}(
                  {method.parameters
                    .map(
                      (parameter) =>
                        `${parameter.name}: ${questionTypeName(parameter.type, language)}`,
                    )
                    .join(", ")}
                  ) → {questionTypeName(method.returnType, language)}
                </code>
              </p>
            ))}
          </section>
        )
      }
    >
      {children}
    </ProblemStatement>
  );
}
