import { DifficultySegments } from "../../ui/DifficultySegments";
import { QuestionLanguage } from "../editor/QuestionLanguage";
import { initialOdysseySource } from "../odyssey/methodStubs";
import { QuestionBasics } from "../../ui/QuestionBasics";
import { useId, useState } from "react";
import { adaptSignature } from "./authoringSignature";
import {
  AuthoringCodeField,
  AuthoringNumberField,
  LeetcodeIDField,
  TopicField,
} from "./AuthoringInputs";
import { SignatureFields } from "./SignatureFields";
import { SelectField } from "../../ui/SelectField";
import { LanguageLogo } from "../../ui/LanguageLogo";
import { AuthoringTabs } from "../../ui/AuthoringTabs";
import { AuthoringCases } from "./AuthoringCases";
import { AuthoringStages } from "./AuthoringStages";
import { Field, JSONField } from "./AuthoringFields";
export { JSONField, validJSONShape } from "./AuthoringFields";
import type { QuestionContent, ProblemVersion } from "@quorem/contracts";
import { ProblemStatement } from "../editor/components/ProblemStatement";
import { StatementMarkdown } from "../editor/components/StatementMarkdown";
import "../editor/components/editorial.css";
import "../odyssey/authoring.css";
import { revisions, type Language } from "./content";
import { languageLabels, solutionLanguageLabel } from "../editor/editorLanguages";

export function QuestionFields({
  content,
  disabled,
  invalidCases = false,
  onChange,
  onValidityChange,
}: {
  content: QuestionContent;
  disabled: boolean;
  invalidCases?: boolean;
  onChange: (content: QuestionContent) => void;
  onValidityChange: (label: string, invalid: boolean) => void;
}) {
  const problem = content.problem;
  const [section, setSection] = useState("question");
  const [language, setLanguage] = useState<Language>(content.problem.sql ? "postgresql" : "python");
  const id = useId();
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
    <QuestionLanguage.Provider value={language}>
      <fieldset disabled={disabled} className="admin-fields question-authoring">
        <legend className="sr-only">Question fields</legend>
        <div className="admin-field-pair">
          <Field label="Question type">
            <SelectField
              label="Question type"
              value={
                problem.sql
                  ? problem.odyssey
                    ? "sql-staged"
                    : "sql-single"
                  : problem.odyssey
                    ? "staged"
                    : "single"
              }
              disabled={disabled || invalidCases}
              options={[
                { value: "single", label: "Single question" },
                { value: "staged", label: "Multi-stage question" },
                { value: "sql-single", label: "SQL question" },
                { value: "sql-staged", label: "SQL multi-stage question" },
              ]}
              onChange={(value) => {
                const isSQL = value.startsWith("sql-");
                const staged = value === "staged" || value === "sql-staged";
                const odyssey = staged
                  ? {
                      levels: [
                        {
                          title: "Step 1",
                          statementMarkdown: problem.statementMarkdown,
                          methods: isSQL ? [] : [problem.signature],
                          examples: [],
                        },
                      ],
                    }
                  : undefined;
                if (isSQL !== !!problem.sql) {
                  const nextLanguage = isSQL ? "postgresql" : "python";
                  setLanguage(nextLanguage);
                  onChange({
                    ...content,
                    problem: {
                      ...problem,
                      sql: isSQL
                        ? {
                            dialect: "postgresql",
                            outputOrder: "unordered",
                            tables: [],
                            output: [],
                          }
                        : undefined,
                      odyssey,
                      examples: [],
                    },
                    hiddenCases: [],
                    odysseyHiddenCases: staged ? [[]] : [],
                    implementations: [
                      {
                        language: nextLanguage,
                        starterSource: "",
                        runtimeRevision: revisions[nextLanguage][0],
                        harnessRevision: revisions[nextLanguage][1],
                        referenceSource: "",
                      },
                    ],
                    solutions: [],
                  });
                } else {
                  const methods = odyssey?.levels[0]?.methods;
                  onChange({
                    ...content,
                    problem: {
                      ...problem,
                      odyssey,
                    },
                    implementations: content.implementations.map((item) =>
                      !isSQL && methods && !item.starterSource
                        ? { ...item, starterSource: initialOdysseySource(methods, item.language) }
                        : item,
                    ),
                    odysseyHiddenCases: staged ? [[]] : [],
                  });
                }
              }}
            />
          </Field>
          <Field label={problem.sql ? "Dialect" : "Language"}>
            <SelectField
              label={problem.sql ? "SQL dialect" : "Question language"}
              value={language}
              disabled={disabled}
              onChange={(value) => setLanguage(value as Language)}
              options={Object.entries(languageLabels)
                .filter(([value]) =>
                  problem.sql ? value === "postgresql" : value !== "postgresql",
                )
                .map(([value, label]) => ({
                  value,
                  label,
                  leading: <LanguageLogo language={value as Language} />,
                }))}
            />
          </Field>
        </div>
        <AuthoringTabs
          id={id}
          label="Question authoring"
          value={section}
          onChange={setSection}
          tabs={[
            { value: "question", label: "Question" },
            { value: "tests", label: problem.odyssey ? "Steps & tests" : "Tests" },
            { value: "solutions", label: "Solutions" },
          ]}
        />
        <div
          role="tabpanel"
          id={`${id}-question-panel`}
          aria-labelledby={`${id}-question`}
          hidden={section !== "question"}
        >
          <QuestionBasics
            title={problem.title}
            statement={problem.statementMarkdown}
            staged={!!problem.odyssey}
            onTitleChange={(title) => {
              const slug = (value: string) =>
                value
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "")
                  .slice(0, 56);
              setProblem({
                title,
                ...(!problem.slug || problem.slug === slug(problem.title)
                  ? { slug: slug(title) }
                  : {}),
              });
            }}
            onStatementChange={(statementMarkdown) => setProblem({ statementMarkdown })}
          />
          {!problem.odyssey && !problem.sql && (
            <fieldset className="admin-fields" disabled={disabled || invalidCases}>
              <SignatureFields
                value={problem.signature}
                onChange={(signature) => onChange(adaptSignature(content, signature))}
                onValidityChange={onValidityChange}
              />
            </fieldset>
          )}
          {invalidCases && (
            <p className="admin-error">Fix test values before changing the method.</p>
          )}
          <details className="authoring-options">
            <summary>Question details</summary>
            <div className="admin-field-pair">
              <Field label="Slug">
                <input
                  value={problem.slug}
                  onChange={(event) => setProblem({ slug: event.target.value })}
                />
              </Field>
              <Field label="Difficulty">
                <DifficultySegments
                  selected={[problem.difficulty]}
                  single
                  disabled={disabled}
                  onChange={([difficulty]) => {
                    if (difficulty) setProblem({ difficulty });
                  }}
                />
              </Field>
            </div>
            <TopicField tags={problem.tags} onChange={(tags) => setProblem({ tags })} />
            <TopicField
              label="Companies, separated by commas"
              tags={problem.companies ?? []}
              onChange={(companies) => setProblem({ companies })}
            />
            <LeetcodeIDField
              value={problem.leetcodeId ?? null}
              onChange={(leetcodeId) => setProblem({ leetcodeId })}
              onValidityChange={(invalid) => onValidityChange("leetcodeId", invalid)}
            />
            <Field label="Attribution">
              <input
                value={content.attribution}
                onChange={(event) => onChange({ ...content, attribution: event.target.value })}
              />
            </Field>
            <JSONField
              label="Structured constraints"
              value={problem.constraints}
              onValidityChange={onValidityChange}
              onChange={(constraints) =>
                setProblem({ constraints: constraints as ProblemVersion["constraints"] })
              }
            />
            <div className="admin-field-pair">
              {Object.entries(problem.limits).map(([name, value]) => (
                <AuthoringNumberField
                  key={name}
                  label={name.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
                  value={value}
                  onValidityChange={(invalid) => onValidityChange(`limit:${name}`, invalid)}
                  onChange={(next) => setProblem({ limits: { ...problem.limits, [name]: next } })}
                />
              ))}
            </div>
          </details>
        </div>
        <div
          role="tabpanel"
          id={`${id}-tests-panel`}
          aria-labelledby={`${id}-tests`}
          hidden={section !== "tests"}
        >
          {problem.sql ? (
            <>
              <JSONField
                label="SQL input schema"
                value={problem.sql.tables ?? []}
                onValidityChange={onValidityChange}
                onChange={(tables) =>
                  setProblem({
                    sql: {
                      ...problem.sql!,
                      tables: tables as NonNullable<NonNullable<ProblemVersion["sql"]>["tables"]>,
                    },
                  })
                }
              />
              <JSONField
                label="SQL output schema"
                value={problem.sql.output ?? []}
                onValidityChange={onValidityChange}
                onChange={(output) =>
                  setProblem({
                    sql: {
                      ...problem.sql!,
                      output: output as NonNullable<NonNullable<ProblemVersion["sql"]>["output"]>,
                    },
                  })
                }
              />
              <Field label="Result row order">
                <SelectField
                  label="Result row order"
                  value={problem.sql.outputOrder}
                  options={[
                    { value: "unordered", label: "Any order" },
                    { value: "ordered", label: "Exact order" },
                  ]}
                  onChange={(outputOrder) =>
                    setProblem({
                      sql: { ...problem.sql!, outputOrder: outputOrder as "ordered" | "unordered" },
                    })
                  }
                />
              </Field>
              {problem.odyssey ? (
                <>
                  <JSONField
                    label="SQL stages"
                    value={problem.odyssey.levels}
                    onValidityChange={onValidityChange}
                    onChange={(levels) =>
                      setProblem({
                        odyssey: {
                          levels: levels as NonNullable<ProblemVersion["odyssey"]>["levels"],
                        },
                      })
                    }
                  />
                  <JSONField
                    label="SQL stage hidden cases"
                    value={content.odysseyHiddenCases ?? []}
                    onValidityChange={onValidityChange}
                    onChange={(odysseyHiddenCases) =>
                      onChange({
                        ...content,
                        odysseyHiddenCases:
                          odysseyHiddenCases as QuestionContent["odysseyHiddenCases"],
                      })
                    }
                  />
                </>
              ) : (
                <>
                  <JSONField
                    label="SQL examples"
                    value={problem.examples}
                    onValidityChange={onValidityChange}
                    onChange={(examples) =>
                      setProblem({ examples: examples as ProblemVersion["examples"] })
                    }
                  />
                  <JSONField
                    label="SQL hidden cases"
                    value={content.hiddenCases}
                    onValidityChange={onValidityChange}
                    onChange={(hiddenCases) =>
                      onChange({
                        ...content,
                        hiddenCases: hiddenCases as QuestionContent["hiddenCases"],
                      })
                    }
                  />
                </>
              )}
              <p>
                Each case supplies table names and rows in args, and result rows in expected. Column
                names and types come from the schema. Numeric results use {`{"$numeric":"1.25"}`} to
                retain precision.
              </p>
            </>
          ) : problem.odyssey ? (
            <AuthoringStages
              content={content}
              onChange={onChange}
              onValidityChange={onValidityChange}
            />
          ) : (
            <AuthoringCases
              key={JSON.stringify([
                problem.signature.parameters.map((p) => p.type),
                problem.signature.returnType,
              ])}
              content={content}
              onChange={onChange}
              onValidityChange={onValidityChange}
            />
          )}
        </div>
        <div
          role="tabpanel"
          id={`${id}-solutions-panel`}
          aria-labelledby={`${id}-solutions`}
          hidden={section !== "solutions"}
        >
          {[language].map((language) => {
            const index = content.implementations.findIndex((item) => item.language === language);
            const implementation = content.implementations[index];
            const solution = content.solutions.find((item) => item.language === language);
            return (
              <div key={language}>
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={!!implementation}
                    disabled={language === "python" || language === "postgresql"}
                    onChange={(event) =>
                      onChange({
                        ...content,
                        implementations: event.target.checked
                          ? [
                              ...content.implementations,
                              {
                                language,
                                starterSource: problem.odyssey
                                  ? initialOdysseySource(
                                      problem.odyssey.levels[0]!.methods,
                                      language,
                                    )
                                  : "",
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
                    <AuthoringCodeField
                      label={`${solutionLanguageLabel(language)} private judge reference`}
                      language={language}
                      source={implementation.referenceSource}
                      disabled={disabled}
                      onChange={(source) => setImplementation(index, { referenceSource: source })}
                    />
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
                        <AuthoringCodeField
                          label={`${solutionLanguageLabel(language)} editorial code`}
                          language={language}
                          source={solution.source}
                          disabled={disabled}
                          onChange={(source) => setSolution(language, { source })}
                        />
                        <Field label={`${solutionLanguageLabel(language)} explanation`}>
                          <textarea
                            rows={5}
                            value={solution.explanationMarkdown}
                            onChange={(event) =>
                              setSolution(language, { explanationMarkdown: event.target.value })
                            }
                          />
                        </Field>
                        <div className="admin-field-pair">
                          <Field label={`${solutionLanguageLabel(language)} time complexity`}>
                            <input
                              value={solution.timeComplexity}
                              onChange={(event) =>
                                setSolution(language, { timeComplexity: event.target.value })
                              }
                            />
                          </Field>
                          <Field
                            label={`${solutionLanguageLabel(language)} auxiliary space complexity`}
                          >
                            <input
                              value={solution.spaceComplexity}
                              onChange={(event) =>
                                setSolution(language, { spaceComplexity: event.target.value })
                              }
                            />
                          </Field>
                        </div>
                        <Field label={`${solutionLanguageLabel(language)} complexity definitions`}>
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
              </div>
            );
          })}
        </div>
      </fieldset>
    </QuestionLanguage.Provider>
  );
}

export function PublicPreview({ content }: { content: QuestionContent }) {
  return (
    <div className="admin-preview">
      <ProblemStatement problem={content.problem} />
      {content.solutions.map((solution) => (
        <section key={solution.language}>
          <h2>{solutionLanguageLabel(solution.language as Language)} solution</h2>
          {solution.explanationMarkdown && (
            <StatementMarkdown source={solution.explanationMarkdown} />
          )}
          <pre className="editorial-source">
            <code>{solution.source}</code>
          </pre>
          {solution.timeComplexity && solution.spaceComplexity && (
            <p>
              Time: {solution.timeComplexity} · Auxiliary space: {solution.spaceComplexity}
            </p>
          )}
          {solution.complexityNotes && <StatementMarkdown source={solution.complexityNotes} />}
        </section>
      ))}
    </div>
  );
}
