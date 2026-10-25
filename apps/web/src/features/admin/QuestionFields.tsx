/** @file QuestionFields.tsx @description Typed metadata and language editorial authoring. @module admin */
import { SignatureFields } from "./SignatureFields";
import { SelectField } from "../../ui/SelectField";
import { AuthoringCases } from "./AuthoringCases";
import { Field, JSONField } from "./AuthoringFields";
export { JSONField, validJSONShape } from "./AuthoringFields";
import type { QuestionContent, ProblemVersion } from "@quorem/contracts";
import { ProblemStatement } from "../editor/components/ProblemStatement";
import { StatementMarkdown } from "../editor/components/StatementMarkdown";
import "../editor/components/editorial.css";
import { OdysseyFields } from "../odyssey/OdysseyFields";
import { revisions, languageLabels, type Language } from "./content";
/** Field groups share the wire types, with JSON reserved for typed collections. */
export function QuestionFields({
  content,
  disabled,
  onChange,
  onValidityChange,
}: {
  content: QuestionContent;
  disabled: boolean;
  onValidityChange: (label: string, invalid: boolean) => void;
  onChange: (content: QuestionContent) => void;
}) {
  const problem = content.problem;
  function setProblem(patch: Partial<ProblemVersion>) {
    onChange({ ...content, problem: { ...problem, ...patch } });
  }
  function setImplementation(
    index: number,
    patch: Partial<QuestionContent["implementations"][number]>,
  ) {
    onChange({
      ...content,
      implementations: content.implementations.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    });
  }
  function setSolution(language: Language, patch: Partial<QuestionContent["solutions"][number]>) {
    const current = content.solutions.find((item) => item.language === language);
    const next = {
      language,
      source: "",
      explanationMarkdown: "",
      timeComplexity: "",
      spaceComplexity: "",
      complexityNotes: "",
      ...current,
      ...patch,
    };
    onChange({
      ...content,
      solutions: [...content.solutions.filter((item) => item.language !== language), next],
    });
  }
  return (
    <fieldset disabled={disabled} className="admin-fields">
      <legend className="sr-only">Question fields</legend>
      <section>
        <h2>Problem</h2>
        <div className="admin-field-pair">
          <Field label="Title">
            <input
              value={problem.title}
              onChange={(event) => setProblem({ title: event.target.value })}
            />
          </Field>
          <Field label="Slug">
            <input
              value={problem.slug}
              onChange={(event) => setProblem({ slug: event.target.value })}
            />
          </Field>
        </div>
        <div className="admin-field-pair">
          <Field label="Difficulty">
            <SelectField
              label="Difficulty"
              value={problem.difficulty}
              disabled={disabled}
              onChange={(value) =>
                setProblem({ difficulty: value as ProblemVersion["difficulty"] })
              }
              options={[
                { value: "easy", label: "Easy" },
                { value: "medium", label: "Medium" },
                { value: "hard", label: "Hard" },
              ]}
            />
          </Field>
          <Field label="Topics, separated by commas">
            <input
              value={problem.tags.join(", ")}
              onChange={(event) =>
                setProblem({
                  tags: [
                    ...new Set(
                      event.target.value
                        .split(",")
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    ),
                  ],
                })
              }
            />
          </Field>
        </div>
        <Field label="Statement">
          <textarea
            rows={7}
            value={problem.statementMarkdown}
            onChange={(event) => setProblem({ statementMarkdown: event.target.value })}
          />
        </Field>
        <Field label="Attribution">
          <input
            value={content.attribution}
            onChange={(event) => onChange({ ...content, attribution: event.target.value })}
          />
        </Field>
      </section>
      <section>
        <h2>Signature and cases</h2>
        <SignatureFields
          value={problem.signature}
          onChange={(signature) => setProblem({ signature })}
          onValidityChange={onValidityChange}
        />
        <details className="admin-language">
          <summary>Execution limits</summary>
          <div className="admin-field-pair">
            {Object.entries(problem.limits).map(([name, value]) => (
              <Field
                key={name}
                label={name.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
              >
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={value}
                  onChange={(event) => {
                    const next = event.target.valueAsNumber;
                    onValidityChange(`limit:${name}`, !Number.isSafeInteger(next) || next < 1);
                    if (Number.isSafeInteger(next) && next > 0)
                      setProblem({ limits: { ...problem.limits, [name]: next } });
                  }}
                />
              </Field>
            ))}
          </div>
        </details>
        <JSONField
          onValidityChange={onValidityChange}
          label="Structured constraints"
          value={problem.constraints}
          onChange={(constraints) =>
            setProblem({ constraints: constraints as ProblemVersion["constraints"] })
          }
        />
        {!problem.odyssey && (
          <AuthoringCases
            key={JSON.stringify(problem.signature)}
            content={content}
            onChange={onChange}
            onValidityChange={onValidityChange}
          />
        )}
      </section>
      <OdysseyFields content={content} onChange={onChange} onValidityChange={onValidityChange} />
      <section>
        <h2>Languages and solutions</h2>
        <p>Starter and trusted judge reference code are separate from published editorial code.</p>
        {(Object.keys(revisions) as Language[]).map((language) => {
          const index = content.implementations.findIndex((item) => item.language === language);
          const implementation = content.implementations[index];
          const solution = content.solutions.find((item) => item.language === language);
          return (
            <details
              className="admin-language"
              key={language}
              open={language === "python" ? true : undefined}
            >
              <summary>{languageLabels[language]}</summary>
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={!!implementation}
                  disabled={language === "python"}
                  onChange={(event) =>
                    onChange({
                      ...content,
                      implementations: event.target.checked
                        ? [
                            ...content.implementations,
                            {
                              language,
                              starterSource: "",
                              runtimeRevision: revisions[language][0],
                              harnessRevision: revisions[language][1],
                              referenceSource: "",
                            },
                          ]
                        : content.implementations.filter((item) => item.language !== language),
                      solutions: event.target.checked
                        ? content.solutions
                        : content.solutions.filter((item) => item.language !== language),
                    })
                  }
                />
                Enable language
              </label>
              {implementation && (
                <>
                  <Field label={`${languageLabels[language]} starter code`}>
                    <textarea
                      className="admin-code"
                      rows={7}
                      value={implementation.starterSource}
                      onChange={(event) =>
                        setImplementation(index, { starterSource: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={`${languageLabels[language]} private judge reference`}>
                    <textarea
                      className="admin-code"
                      rows={7}
                      value={implementation.referenceSource}
                      onChange={(event) =>
                        setImplementation(index, { referenceSource: event.target.value })
                      }
                    />
                  </Field>
                  <label className="admin-check">
                    <input
                      type="checkbox"
                      checked={!!solution}
                      onChange={(event) =>
                        event.target.checked
                          ? setSolution(language, {})
                          : onChange({
                              ...content,
                              solutions: content.solutions.filter(
                                (item) => item.language !== language,
                              ),
                            })
                      }
                    />
                    Publish editorial solution
                  </label>
                  {solution && (
                    <>
                      <Field label={`${languageLabels[language]} editorial code`}>
                        <textarea
                          className="admin-code"
                          rows={7}
                          value={solution.source}
                          onChange={(event) =>
                            setSolution(language, { source: event.target.value })
                          }
                        />
                      </Field>
                      <Field label={`${languageLabels[language]} explanation`}>
                        <textarea
                          rows={5}
                          value={solution.explanationMarkdown}
                          onChange={(event) =>
                            setSolution(language, { explanationMarkdown: event.target.value })
                          }
                        />
                      </Field>
                      <div className="admin-field-pair">
                        <Field label={`${languageLabels[language]} time complexity`}>
                          <input
                            value={solution.timeComplexity}
                            onChange={(event) =>
                              setSolution(language, { timeComplexity: event.target.value })
                            }
                          />
                        </Field>
                        <Field label={`${languageLabels[language]} auxiliary space complexity`}>
                          <input
                            value={solution.spaceComplexity}
                            onChange={(event) =>
                              setSolution(language, { spaceComplexity: event.target.value })
                            }
                          />
                        </Field>
                      </div>
                      <Field label={`${languageLabels[language]} complexity definitions`}>
                        <textarea
                          rows={3}
                          value={solution.complexityNotes}
                          onChange={(event) =>
                            setSolution(language, { complexityNotes: event.target.value })
                          }
                        />
                      </Field>
                    </>
                  )}
                </>
              )}
            </details>
          );
        })}
      </section>
    </fieldset>
  );
}

/** Public preview excludes every private reference and hidden test. */
export function PublicPreview({ content }: { content: QuestionContent }) {
  return (
    <div className="admin-preview">
      <ProblemStatement problem={content.problem} />
      {content.solutions.map((solution) => (
        <section key={solution.language}>
          <h2>{languageLabels[solution.language as Language]} solution</h2>
          <StatementMarkdown source={solution.explanationMarkdown} />
          <pre className="editorial-source">
            <code>{solution.source}</code>
          </pre>
          <p>
            Time: {solution.timeComplexity} · Auxiliary space: {solution.spaceComplexity}
          </p>
          <StatementMarkdown source={solution.complexityNotes} />
        </section>
      ))}
    </div>
  );
}
