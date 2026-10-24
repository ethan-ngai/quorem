/** @file QuestionFields.tsx @description Typed metadata and language editorial authoring. @module admin */
import { useState, type ReactNode } from "react";
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
            <select
              value={problem.difficulty}
              onChange={(event) =>
                setProblem({ difficulty: event.target.value as ProblemVersion["difficulty"] })
              }
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </Field>
          <Field label="Topics, separated by commas">
            <input
              value={problem.tags.join(", ")}
              onChange={(event) =>
                setProblem({ tags: event.target.value.split(",").map((tag) => tag.trim()) })
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
        <JSONField
          onValidityChange={onValidityChange}
          label="Typed signature"
          value={problem.signature}
          onChange={(signature) =>
            setProblem({ signature: signature as ProblemVersion["signature"] })
          }
        />
        <JSONField
          onValidityChange={onValidityChange}
          label="Execution limits"
          value={problem.limits}
          onChange={(limits) => setProblem({ limits: limits as ProblemVersion["limits"] })}
        />
        <JSONField
          onValidityChange={onValidityChange}
          label="Structured constraints"
          value={problem.constraints}
          onChange={(constraints) =>
            setProblem({ constraints: constraints as ProblemVersion["constraints"] })
          }
        />
        <JSONField
          onValidityChange={onValidityChange}
          label="Public examples with explanations"
          value={problem.examples}
          onChange={(examples) => setProblem({ examples: examples as ProblemVersion["examples"] })}
        />
        <JSONField
          onValidityChange={onValidityChange}
          label={
            problem.odyssey
              ? "Legacy hidden cases (unused for Odyssey)"
              : "Hidden cases (20 required)"
          }
          value={content.hiddenCases}
          onChange={(hiddenCases) =>
            onChange({ ...content, hiddenCases: hiddenCases as QuestionContent["hiddenCases"] })
          }
        />
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

/** @returns A labeled field that keeps native focus and keyboard behavior. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Retains invalid JSON text for correction instead of reverting the user's input. */
export function JSONField({
  label,
  value,
  onChange,
  onValidityChange,
}: {
  label: string;
  value: unknown;
  onValidityChange: (label: string, invalid: boolean) => void;
  onChange: (value: unknown) => void;
}) {
  const [source, setSource] = useState(() => JSON.stringify(value, null, 2));
  const [invalid, setInvalid] = useState(false);
  return (
    <Field label={label}>
      <textarea
        className="admin-code"
        rows={6}
        value={source}
        aria-invalid={invalid}
        onChange={(event) => {
          setSource(event.target.value);
          try {
            const parsed: unknown = JSON.parse(event.target.value);
            if (!validJSONShape(label, parsed)) throw new Error("Invalid shape");
            setInvalid(false);
            onValidityChange(label, false);
            onChange(parsed);
          } catch {
            setInvalid(true);
            onValidityChange(label, true);
          }
        }}
      />
      {invalid && (
        <span className="admin-error">Invalid JSON or shape. Fix this field before saving.</span>
      )}
    </Field>
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

/** Prevents malformed typed collections from reaching preview rendering. */
export function validJSONShape(label: string, value: unknown): boolean {
  const record = (item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === "object" && !Array.isArray(item);
  if (label === "Typed signature")
    return (
      record(value) &&
      typeof value.className === "string" &&
      typeof value.methodName === "string" &&
      typeof value.returnType === "string" &&
      Array.isArray(value.parameters) &&
      value.parameters.every(
        (parameter) =>
          record(parameter) &&
          typeof parameter.name === "string" &&
          typeof parameter.type === "string",
      )
    );
  if (label === "Execution limits")
    return (
      record(value) &&
      [
        "wallTimeMs",
        "memoryBytes",
        "outputBytes",
        "maxProcesses",
        "maxCollectionElements",
        "maxNestingDepth",
      ].every(
        (name) =>
          typeof value[name] === "number" &&
          Number.isSafeInteger(value[name]) &&
          Number(value[name]) > 0,
      )
    );
  if (!Array.isArray(value)) return false;
  if (label.startsWith("Level ") && label.endsWith("methods"))
    return value.every((item) => validJSONShape("Typed signature", item));
  if (label.startsWith("Level "))
    return value.every(
      (item) =>
        record(item) &&
        Array.isArray(item.args) &&
        (item.calls === undefined || Array.isArray(item.calls)),
    );
  if (label === "Structured constraints") {
    const target = (item: unknown) =>
      record(item) && typeof item.parameter === "string" && typeof item.projection === "string";
    return value.every(
      (item) =>
        record(item) &&
        (item.kind === "prose"
          ? typeof item.text === "string"
          : item.kind === "range" || item.kind === "property"
            ? target(item.target)
            : item.kind === "comparison"
              ? target(item.left) && target(item.right)
              : false),
    );
  }
  return value.every((item) => record(item) && Array.isArray(item.args) && "expected" in item);
}
