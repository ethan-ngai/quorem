/** @file ProblemStatement.tsx @description Problem prose and coding-site example hierarchy. @module editor */
import { StatementMarkdown, inlineStatement } from "./StatementMarkdown";
import { Icon } from "./Icon";
import type { ProblemVersion } from "@quorem/contracts";

/** @returns Named argument values in the public function's declared order. */
export function exampleInput(problem: ProblemVersion, args: unknown[]) {
  return args
    .map(
      (value, index) =>
        `${problem.signature.parameters[index]?.name ?? `arg${index + 1}`} = ${JSON.stringify(value)}`,
    )
    .join(", ");
}

/** Shows the problem directly, with optional topics and named public examples. */
export function ProblemStatement({ problem }: { problem: ProblemVersion }) {
  return (
    <div className="problem-scroll">
      <div className="problem-heading">
        <h1>{problem.title}</h1>
        <div className="problem-meta">
          <span className={`difficulty difficulty-${problem.difficulty}`}>
            {problem.difficulty}
          </span>
          {problem.tags.length > 0 && (
            <details className="topic-disclosure">
              <summary>
                Topics
                <Icon name="chevron" />
              </summary>
              <div className="tag-list" aria-label="Problem topics">
                {problem.tags.map((tag) => (
                  <span className="problem-tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
      <div className="problem-copy">
        <StatementMarkdown source={problem.statementMarkdown} />
      </div>
      <ol className="example-list" aria-label="Examples">
        {problem.examples.map((example, index) => (
          <li key={index}>
            <h2>Example {index + 1}:</h2>
            <div className="example-data">
              <div>
                <strong>Input:</strong> <code>{exampleInput(problem, example.args)}</code>
              </div>
              <div>
                <strong>Output:</strong> <code>{JSON.stringify(example.expected)}</code>
              </div>
            </div>
            {example.explanation && (
              <p>
                <strong>Explanation:</strong> {inlineStatement(example.explanation)}
              </p>
            )}
          </li>
        ))}
      </ol>
      <section className="problem-section" aria-labelledby="constraints-heading">
        <h2 id="constraints-heading">Constraints:</h2>
        <ul className="constraint-list">
          {problem.constraints.map((constraint) => (
            <li key={constraint}>{inlineStatement(constraint)}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
