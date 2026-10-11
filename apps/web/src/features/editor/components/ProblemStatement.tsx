/** @file ProblemStatement.tsx @description Problem prose and coding-site example hierarchy. @module editor */
import { useId, useState } from "react";
import { StatementMarkdown, inlineStatement } from "./StatementMarkdown";
import { Icon } from "./Icon";
import { bindArguments } from "../argumentBinding";
import { constraintMarkup } from "../constraintMarkup";
import type { ProblemVersion } from "@quorem/contracts";

/** @returns Named argument values in the public function's declared order. */
export function exampleInput(problem: ProblemVersion, args: unknown[]) {
  return bindArguments(problem.signature, args)
    .map(({ name, value }) => `${name} = ${JSON.stringify(value)}`)
    .join(", ");
}

/** Shows the problem directly, with optional topics and named public examples. */
export function ProblemStatement({ problem }: { problem: ProblemVersion }) {
  const [revealedTopicsFor, setRevealedTopicsFor] = useState<string>();
  const topicsVisible = revealedTopicsFor === problem.id;
  const topicsId = useId();
  return (
    <div className="problem-scroll">
      <div className="problem-heading">
        <h1>{problem.title}</h1>
        <div className="problem-meta">
          <span className={`difficulty difficulty-${problem.difficulty}`}>
            {problem.difficulty}
          </span>
          {problem.tags.length > 0 && (
            <button
              className="topics-toggle"
              aria-label={topicsVisible ? "Hide topics" : "Show topics"}
              aria-expanded={topicsVisible}
              aria-controls={topicsId}
              onClick={() => setRevealedTopicsFor(topicsVisible ? undefined : problem.id)}
            >
              <Icon name={topicsVisible ? "eye-off" : "eye"} />
              Topics
            </button>
          )}
        </div>
      </div>
      {problem.tags.length > 0 && (
        <div
          id={topicsId}
          className="topic-list"
          data-visible={topicsVisible}
          aria-hidden={!topicsVisible}
        >
          {problem.tags.map((tag) => (
            <span key={tag}>
              {tag.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}
            </span>
          ))}
        </div>
      )}
      <div className="problem-copy">
        <StatementMarkdown source={problem.statementMarkdown} />
      </div>
      {problem.examples.length > 0 && (
        <section className="problem-section" aria-labelledby="examples-heading">
          <h2 id="examples-heading">Examples</h2>
          <ol className="example-list">
            {problem.examples.map((example, index) => (
              <li key={index} aria-label={`Example ${index + 1}`}>
                <div className="example-content">
                  <div className="example-data">
                    <div>
                      <span className="value-label">
                        <Icon name="input" />
                        Input
                      </span>
                      <code>{exampleInput(problem, example.args)}</code>
                    </div>
                    <div>
                      <span className="value-label">
                        <Icon name="output" />
                        Output
                      </span>
                      <code>{JSON.stringify(example.expected)}</code>
                    </div>
                  </div>
                  <div className="example-explanation">
                    {example.explanation && (
                      <p>
                        <strong>Explanation:</strong> {inlineStatement(example.explanation)}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="problem-section" aria-labelledby="constraints-heading">
        <h2 id="constraints-heading">Constraints:</h2>
        <ul className="constraint-list">
          {problem.constraints.map((constraint, constraintIndex) => {
            return <li key={constraintIndex}>{inlineStatement(constraintMarkup(constraint))}</li>;
          })}
        </ul>
      </section>
    </div>
  );
}
