import { primarySignature } from "@quorem/questions";
import "./machine-values.css";
import "./problem-statement.css";
import { formatLabel } from "../../../ui/formatLabel";
/** @file ProblemStatement.tsx @description Problem prose and coding-site example hierarchy. @module editor */
import { AuthoringTabs } from "../../../ui/AuthoringTabs";
import { SqlSchema, SqlTables } from "./SqlTables";
import { CaseArguments, CaseValue } from "./CaseOutput";
import { SequenceCaseValues } from "./SequenceCaseValues";
import { useId, useState, type ReactNode } from "react";
import { StatementMarkdown, inlineStatement } from "./StatementMarkdown";
import { Icon, VisibilityIcon } from "../../../ui/Icon";
import { Tooltip } from "../../../ui/Tooltip";
import { constraintListMarkup } from "../constraintMarkup";
import type { QuestionProblem } from "@quorem/contracts";

export type StatementProblem = Pick<
  QuestionProblem,
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

/** Shows the problem directly, with optional topics and named public examples. */
export function ProblemStatement({
  problem,
  children,
  navigation,
  beforeExamples,
  allowTopics = true,
  requestTopics,
  topicsDisabled = false,
}: {
  problem: StatementProblem;
  children?: ReactNode;
  navigation?: ReactNode;
  beforeExamples?: ReactNode;
  allowTopics?: boolean;
  requestTopics?: (anchor: HTMLButtonElement, open: (tags: string[]) => void) => void;
  topicsDisabled?: boolean;
}) {
  const [selection, setSelection] = useState({ problemId: problem.id, index: 0 });
  const selectedExample =
    selection.problemId === problem.id
      ? Math.min(selection.index, Math.max(0, problem.examples.length - 1))
      : 0;
  const examplesId = useId();
  const [revealedTopicsFor, setRevealedTopicsFor] = useState<string>();
  const topicsVisible = revealedTopicsFor === problem.id;
  const [grantedTopics, setGrantedTopics] = useState<{ id: string; tags: string[] }>();
  const matchTopics = grantedTopics?.id === problem.id ? grantedTopics.tags : undefined;
  const topics = requestTopics ? (matchTopics ?? []) : problem.tags;
  const showTopicsControl = allowTopics && (!!requestTopics || topics.length > 0);
  const topicsId = useId();
  function toggleTopics(anchor: HTMLButtonElement) {
    if (topicsVisible) setRevealedTopicsFor(undefined);
    else if (requestTopics && !matchTopics) {
      if (topicsDisabled) return;
      requestTopics(anchor, (tags) => {
        setGrantedTopics({ id: problem.id, tags });
        setRevealedTopicsFor(problem.id);
      });
    } else setRevealedTopicsFor(problem.id);
  }
  function exampleArgument(example: number | undefined, argument: string) {
    if (example === undefined || problem.sql || problem.odyssey) return;
    const index = primarySignature(problem).parameters.findIndex(({ name }) => name === argument);
    return problem.examples[example - 1]?.args[index];
  }
  return (
    <div className="problem-scroll">
      <div className="problem-heading">
        <h1>{problem.title}</h1>
        <div className="problem-meta">
          <span className={`difficulty difficulty-${problem.difficulty}`}>
            {problem.difficulty}
          </span>
          {showTopicsControl && (
            <button
              className="quiet-button topics-toggle"
              aria-label={topicsVisible ? "Hide topics" : "Show topics"}
              aria-expanded={topicsVisible}
              aria-controls={topicsId}
              aria-disabled={!!requestTopics && !matchTopics && topicsDisabled}
              aria-haspopup={requestTopics && !matchTopics ? "dialog" : undefined}
              onClick={(event) => toggleTopics(event.currentTarget)}
            >
              <VisibilityIcon visible={topicsVisible} />
              Topics
            </button>
          )}
        </div>
      </div>
      {showTopicsControl && (
        <div
          id={topicsId}
          className="topic-list"
          data-visible={topicsVisible}
          aria-hidden={!topicsVisible}
        >
          {topics.map((tag) => (
            <span key={tag}>{formatLabel(tag)}</span>
          ))}
        </div>
      )}
      <div className="problem-body">
        {navigation}
        <div className="problem-copy">
          <StatementMarkdown
            source={problem.statementMarkdown}
            allowFigures
            exampleArgument={exampleArgument}
          />
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
                        <SqlTables
                          input
                          label="Input"
                          schema={problem.sql}
                          value={example.args[0]}
                        />
                        <SqlTables label="Output" schema={problem.sql} value={example.expected} />
                      </div>
                    ) : (
                      <div className="example-data">
                        <CaseArguments
                          signature={primarySignature(problem)}
                          args={example.args}
                          expected={example.expected}
                        >
                          <CaseValue
                            name="Output"
                            purpose="output"
                            value={example.expected}
                            type={primarySignature(problem).returnType}
                            nodeContext={{
                              signature: primarySignature(problem),
                              args: example.args,
                            }}
                          />
                        </CaseArguments>
                      </div>
                    )}
                    <div className="example-explanation">
                      {example.explanation && (
                        <div className="example-explanation-content">
                          <Tooltip content="Explanation">
                            <span
                              className="explanation-icon"
                              tabIndex={0}
                              aria-label="Explanation"
                            >
                              <Icon name="explanation" />
                            </span>
                          </Tooltip>
                          <div>
                            <StatementMarkdown
                              source={example.explanation}
                              allowFigures
                              exampleArgument={(number, argument) =>
                                exampleArgument(number ?? selectedExample + 1, argument)
                              }
                            />
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
              {constraintListMarkup(problem.constraints).map((markup, index) => (
                <li key={index}>{inlineStatement(markup)}</li>
              ))}
            </ul>
          </section>
        )}
        {children}
      </div>
    </div>
  );
}
