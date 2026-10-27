import "./machine-values.css";
import "./problem-statement.css";
import { formatLabel } from "../../../ui/formatLabel";
/** @file ProblemStatement.tsx @description Problem prose and coding-site example hierarchy. @module editor */
import { AuthoringTabs } from "../../../ui/AuthoringTabs";
import { SqlSchema, SqlTables } from "./SqlTables";
import { SequenceCaseValues } from "./SequenceCaseValues";
import { useQuestionLanguage } from "../QuestionLanguage";
import { questionValue } from "../questionTypes";
import type { EditorLanguage } from "../editorLanguages";
import { useId, useState, type ReactNode } from "react";
import { StatementMarkdown, inlineStatement } from "./StatementMarkdown";
import { Icon, VisibilityIcon } from "../../../ui/Icon";
import { Tooltip } from "../../../ui/Tooltip";
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
  | "sql"
>;

/** @returns Named argument values in the public function's declared order. */
export function exampleInput(
  problem: Pick<ProblemVersion, "signature" | "sql">,
  args: unknown[],
  language: EditorLanguage = "python",
) {
  return bindArguments(problem.signature, args)
    .map(({ name, value }) => `${name} = ${questionValue(value, language)}`)
    .join(", ");
}

/** Shows the problem directly, with optional topics and named public examples. */
export function ProblemStatement({
  problem,
  children,
  navigation,
  beforeExamples,
  allowTopics = true,
}: {
  problem: StatementProblem;
  children?: ReactNode;
  navigation?: ReactNode;
  beforeExamples?: ReactNode;
  allowTopics?: boolean;
}) {
  const language = useQuestionLanguage();
  const [selection, setSelection] = useState({ problemId: problem.id, index: 0 });
  const selectedExample =
    selection.problemId === problem.id
      ? Math.min(selection.index, Math.max(0, problem.examples.length - 1))
      : 0;
  const examplesId = useId();
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
          {allowTopics && problem.tags.length > 0 && (
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
      {allowTopics && problem.tags.length > 0 && (
        <div
          id={topicsId}
          className="topic-list"
          data-visible={topicsVisible}
          aria-hidden={!topicsVisible}
        >
          {problem.tags.map((tag) => (
            <span key={tag}>{formatLabel(tag)}</span>
          ))}
        </div>
      )}
      {navigation}
      <div className="problem-copy">
        <StatementMarkdown source={problem.statementMarkdown} />
      </div>
      {problem.sql && <SqlSchema schema={problem.sql} />}
      {beforeExamples}
      {problem.examples.length > 0 && (
        <section className="problem-section" aria-labelledby={`${examplesId}-heading`}>
          <h2 id={`${examplesId}-heading`}>Examples</h2>
          <div className="example-navigation">
            <AuthoringTabs
              id={examplesId}
              label="Examples"
              appearance="underline"
              tabs={problem.examples.map((_, index) => ({
                value: String(index),
                label: `Example ${index + 1}`,
              }))}
              value={String(selectedExample)}
              onChange={(value) => setSelection({ problemId: problem.id, index: Number(value) })}
            />
          </div>
          <div className="example-list">
            {problem.examples.slice(selectedExample, selectedExample + 1).map((example) => (
              <div
                key={selectedExample}
                role="tabpanel"
                id={`${examplesId}-${selectedExample}-panel`}
                aria-labelledby={`${examplesId}-${selectedExample}`}
                tabIndex={0}
              >
                <div className="example-content">
                  {example.calls?.length ? (
                    <div className="example-sequence">
                      <SequenceCaseValues
                        problem={problem}
                        calls={example.calls}
                        outputLabel="Output"
                      />
                    </div>
                  ) : problem.sql ? (
                    <div className="sql-example-data">
                      <div className="sql-example-label">Input</div>
                      <SqlTables input label="Input" schema={problem.sql} value={example.args[0]} />
                      <SqlTables label="Output" schema={problem.sql} value={example.expected} />
                    </div>
                  ) : (
                    <div className="example-data">
                      <div>
                        <Tooltip content="Input">
                          <span className="value-label" tabIndex={0} aria-label="Input">
                            <Icon name="input" />
                          </span>
                        </Tooltip>
                        <code>{exampleInput(problem, example.args, language)}</code>
                      </div>
                      <div>
                        <Tooltip content="Output">
                          <span className="value-label" tabIndex={0} aria-label="Output">
                            <Icon name="output" />
                          </span>
                        </Tooltip>
                        <code>
                          {questionValue(example.expected, language, problem.signature.returnType)}
                        </code>
                      </div>
                    </div>
                  )}
                  <div className="example-explanation">
                    {example.explanation && (
                      <div className="example-explanation-content">
                        <Tooltip content="Explanation">
                          <span className="explanation-icon" tabIndex={0} aria-label="Explanation">
                            <Icon name="explanation" />
                          </span>
                        </Tooltip>
                        <div>
                          <StatementMarkdown source={example.explanation} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
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
