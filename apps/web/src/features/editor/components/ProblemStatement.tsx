/** @file ProblemStatement.tsx @description Renders the public problem definition. @module editor */
import type { ProblemVersion } from "@quorem/contracts";

/** Shows the statement, public examples, constraints, and signature. */
export function ProblemStatement({ problem }: { problem: ProblemVersion }) {
  return (
    <div className="problem-scroll">
      <div className="problem-heading">
        <div className="eyebrow">{problem.difficulty} · v{problem.version}</div>
        <h1>{problem.title}</h1>
        <div className="tag-list" aria-label="Problem tags">
          {problem.tags.map((tag) => <span className="problem-tag" key={tag}>{tag}</span>)}
        </div>
      </div>
      <div className="problem-copy">{problem.statementMarkdown}</div>
      <section className="problem-section" aria-labelledby="examples-heading">
        <h2 id="examples-heading">Examples</h2>
        <ol className="example-list">
          {problem.examples.map((example, index) => (
            <li key={index}>
              <div className="example-line"><span>Input</span><code>{JSON.stringify(example.args)}</code></div>
              <div className="example-line"><span>Output</span><code>{JSON.stringify(example.expected)}</code></div>
              {example.explanation && <p>{example.explanation}</p>}
            </li>
          ))}
        </ol>
      </section>
      <section className="problem-section" aria-labelledby="constraints-heading">
        <h2 id="constraints-heading">Constraints</h2>
        <ul className="constraint-list">
          {problem.constraints.map((constraint) => <li key={constraint}><code>{constraint}</code></li>)}
        </ul>
      </section>
      <div className="signature-note">
        <span className="eyebrow">Python signature</span>
        <code>{problem.signature.className}.{problem.signature.methodName}({problem.signature.parameters.map(({ name }) => name).join(", ")})</code>
      </div>
    </div>
  );
}
