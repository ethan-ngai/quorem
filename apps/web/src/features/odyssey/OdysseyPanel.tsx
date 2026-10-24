/** @file OdysseyPanel.tsx @description Authorized levels composed into the shared problem statement. @module odyssey */
import { useState, type ReactNode } from "react";
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
}: {
  progress: OdysseyProgress;
  problem?: StatementProblem;
  title?: string;
  introduction?: string;
  children?: ReactNode;
}) {
  const [requested, setRequested] = useState<number>();
  const index = Math.min(requested ?? progress.level - 1, progress.levels.length - 1);
  const level = progress.levels[index];
  if (!level) return null;
  const statement: StatementProblem = {
    id: problem?.id ?? "odyssey",
    title: problem?.title ?? title ?? level.title,
    difficulty: problem?.difficulty ?? "easy",
    tags: problem?.tags ?? [],
    signature: level.methods[0]!,
    constraints: [],
    examples: level.examples,
    odyssey: { levels: progress.levels },
    statementMarkdown: level.statementMarkdown,
  };
  return (
    <ProblemStatement
      problem={statement}
      navigation={
        <>
          <div className="result-tabs" role="group" aria-label="Unlocked levels">
            {progress.levels.map((item, position) => (
              <button
                key={position}
                aria-pressed={index === position}
                aria-selected={index === position}
                onClick={() => setRequested(position)}
              >
                {position + 1}. {item.title}
              </button>
            ))}
          </div>
          <p className="case-stale" role="status">
            {progress.completed
              ? "All levels complete"
              : `Level ${progress.level} · Submit to unlock the next level. Earlier tests run again.`}
          </p>
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
        <section className="problem-section problem-copy">
          <h2>Methods to implement</h2>
          {level.methods.map((method) => (
            <p key={method.methodName}>
              <code>
                {method.className}.{method.methodName}(
                {method.parameters
                  .map((parameter) => `${parameter.name}: ${parameter.type}`)
                  .join(", ")}
                ) → {method.returnType}
              </code>
            </p>
          ))}
        </section>
      }
    >
      {children}
    </ProblemStatement>
  );
}
