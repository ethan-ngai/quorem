/** @file OdysseyPanel.tsx @description Unlocked level navigation and cumulative method contracts. @module odyssey */
import { useState } from "react";
import type { OdysseyProgress } from "@quorem/contracts";
import { StatementMarkdown } from "../editor/components/StatementMarkdown";
import "./odyssey.css";

/** Displays only the server-authorized prefix; source remains mounted across advancement. */
export function OdysseyPanel({
  progress,
  title,
  introduction,
}: {
  progress: OdysseyProgress;
  title?: string;
  introduction?: string;
}) {
  const [requested, setRequested] = useState<number>();
  const index = Math.min(requested ?? progress.level - 1, progress.levels.length - 1);
  const level = progress.levels[index];
  if (!level) return null;
  return (
    <section className="odyssey-levels" aria-label="Odyssey levels">
      {title && <h1 className="odyssey-title">{title}</h1>}
      {introduction && <StatementMarkdown source={introduction} />}
      <div className="odyssey-navigation" aria-label="Unlocked levels">
        {progress.levels.map((item, position) => (
          <button
            key={position}
            className="quiet-button"
            aria-pressed={index === position}
            onClick={() => setRequested(position)}
          >
            {position + 1}. {item.title}
          </button>
        ))}
      </div>
      <p className="odyssey-progress" role="status">
        {progress.completed
          ? "All levels complete"
          : `Level ${progress.level} · Submit to unlock the next level. Earlier tests run again.`}
      </p>
      <h2>{level.title}</h2>
      <StatementMarkdown source={level.statementMarkdown} />
      <h3>Methods to implement</h3>
      {level.methods.map((method) => (
        <pre key={method.methodName}>
          <code>
            {method.className}.{method.methodName}(
            {method.parameters
              .map((parameter) => `${parameter.name}: ${parameter.type}`)
              .join(", ")}
            ) → {method.returnType}
          </code>
        </pre>
      ))}
      {level.examples.map((example, position) => (
        <details key={position}>
          <summary>Example {position + 1}</summary>
          <pre>
            <code>
              {JSON.stringify(
                example.calls?.length
                  ? example.calls
                  : { args: example.args, expected: example.expected },
                null,
                2,
              )}
            </code>
          </pre>
          {example.explanation && <StatementMarkdown source={example.explanation} />}
        </details>
      ))}
    </section>
  );
}
