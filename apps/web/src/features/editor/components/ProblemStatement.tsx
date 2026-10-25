/** @file ProblemStatement.tsx @description Problem prose and coding-site example hierarchy. @module editor */
import { useId, useState, type ReactNode } from "react";
import { StatementMarkdown, inlineStatement } from "./StatementMarkdown";
import { Icon, VisibilityIcon } from "./Icon";
import { Tooltip } from "./Tooltip";
import { bindArguments } from "../argumentBinding";
import { constraintMarkup } from "../constraintMarkup";
import type { ProblemVersion } from "@quorem/contracts";

export type StatementProblem = Pick<
  ProblemVersion,
  | "id"
  | "title"
  | "difficulty"
  | "tags"
  | "statementMarkdown"
  | "signature"
  | "examples"
  | "constraints"
  | "odyssey"
>;

/** @returns Named argument values in the public function's declared order. */
export function exampleInput(problem: Pick<ProblemVersion, "signature">, args: unknown[]) {
  return bindArguments(problem.signature, args)
    .map(({ name, value }) => `${name} = ${JSON.stringify(value)}`)
    .join(", ");
}

/** Shows the problem directly, with optional topics and named public examples. */
export function ProblemStatement({
  problem,
  children,
  navigation,
  beforeExamples,
}: {
  problem: StatementProblem;
  children?: ReactNode;
  navigation?: ReactNode;
  beforeExamples?: ReactNode;
}) {
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
              <VisibilityIcon visible={topicsVisible} />
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
      {navigation}
      <div className="problem-copy">
        <StatementMarkdown source={problem.statementMarkdown} />
      </div>
      {beforeExamples}
      {problem.examples.length > 0 && (
        <section className="problem-section" aria-labelledby="examples-heading">
          <h2 id="examples-heading">Examples</h2>
          <ol className="example-list">
            {problem.examples.map((example, index) => (
              <li key={index} aria-label={`Example ${index + 1}`}>
                <div className="example-content">
                  <div className="example-data">
                    <div>
                      <Tooltip content="Input">
                        <span className="value-label" tabIndex={0} aria-label="Input">
                          <Icon name="input" />
                        </span>
                      </Tooltip>
                      <code>
                        {example.calls?.length
                          ? example.calls
                              .map((call) => {
                                const signature = problem.odyssey?.levels
                                  .flatMap((level) => level.methods)
                                  .find((method) => method.methodName === call.methodName);
                                return `${call.methodName}(${
                                  signature
                                    ? bindArguments(signature, call.args)
                                        .map(
                                          ({ name, value }) => `${name} = ${JSON.stringify(value)}`,
                                        )
                                        .join(", ")
                                    : call.args.map((value) => JSON.stringify(value)).join(", ")
                                })`;
                              })
                              .join("; ")
                          : exampleInput(problem, example.args)}
                      </code>
                    </div>
                    <div>
                      <Tooltip content="Output">
                        <span className="value-label" tabIndex={0} aria-label="Output">
                          <Icon name="output" />
                        </span>
                      </Tooltip>
                      <code>
                        {JSON.stringify(
                          example.calls?.length
                            ? example.calls.map((call) => call.expected)
                            : example.expected,
                        )}
                      </code>
                    </div>
                  </div>
                  <div className="example-explanation">
                    {example.explanation && (
                      <p>
                        <Tooltip content="Explanation">
                          <span className="explanation-icon" tabIndex={0} aria-label="Explanation">
                            <Icon name="explanation" />
                          </span>
                        </Tooltip>
                        <span>{inlineStatement(example.explanation)}</span>
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      {problem.constraints.length > 0 && (
        <section className="problem-section" aria-labelledby="constraints-heading">
          <h2 id="constraints-heading">Constraints</h2>
          <ul className="constraint-list">
            {problem.constraints.map((constraint, constraintIndex) => {
              return <li key={constraintIndex}>{inlineStatement(constraintMarkup(constraint))}</li>;
            })}
          </ul>
        </section>
      )}
      {children}
    </div>
  );
}
