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
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { SessionDialog } from "../../ui/SessionDialog";
import { SqlStages } from "./SqlStages";
import { SqlSchemaFields } from "./SqlSchemaFields";
import { LanguageLogo } from "../../ui/LanguageLogo";
import { AuthoringTabs } from "../../ui/AuthoringTabs";
import { AuthoringCases } from "./AuthoringCases";
import { AuthoringStages } from "./AuthoringStages";
import { Field } from "./AuthoringFields";
import { ConstraintFields } from "./ConstraintFields";
import type { QuestionContent, ProblemVersion } from "@quorem/contracts";
import { CodeLiteral } from "../editor/components/CodeLiteral";
import { MethodSignature } from "../editor/components/MethodSignature";
import { ProblemStatement } from "../editor/components/ProblemStatement";
import { StatementMarkdown } from "../editor/components/StatementMarkdown";
import "../editor/components/editorial.css";
import "../odyssey/authoring.css";
import { revisions, type Language } from "./content";
import { languageLabels, solutionLanguageLabel } from "../editor/editorLanguages";

const questionTypes = [
  { value: "single", label: "Single question" },
  { value: "staged", label: "Multi-stage question" },
  { value: "sql-single", label: "SQL question" },
  { value: "sql-staged", label: "SQL multi-stage question" },
] as const;
type QuestionType = (typeof questionTypes)[number]["value"];
type AuthoringSection = "question" | "interface" | "tests" | "solutions";
const languages = Object.keys(revisions).filter((key): key is Language =>
  Object.hasOwn(revisions, key),
);

export function QuestionFields({
  content,
  disabled,
  invalidCases = false,
  lockSlug = false,
  onChange,
  onValidityChange,
}: {
  content: QuestionContent;
  disabled: boolean;
  invalidCases?: boolean;
  lockSlug?: boolean;
  onChange: (content: QuestionContent) => void;
  onValidityChange: (label: string, invalid: boolean) => void;
}) {
  const problem = content.problem;
  const [section, setSection] = useState<AuthoringSection>("question");
  const [language, setLanguage] = useState<Language>(content.problem.sql ? "postgresql" : "python");
  const id = useId();
  const [pendingType, setPendingType] = useState<QuestionType>();
  const questionType = problem.sql
    ? problem.odyssey
      ? "sql-staged"
      : "sql-single"
    : problem.odyssey
      ? "staged"
      : "single";
  const tabs = [
    { value: "question", label: "Overview" },
    ...(problem.sql || !problem.odyssey
      ? [{ value: "interface", label: problem.sql ? "Schema" : "Signature" } as const]
      : []),
    { value: "tests", label: problem.odyssey ? "Steps & tests" : "Tests" },
    { value: "solutions", label: "Code & editorial" },
  ] as const;
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
  function changeType(value: QuestionType) {
    const isSQL = value.startsWith("sql-");
    const staged = value === "staged" || value === "sql-staged";
    const odyssey = staged
      ? {
          levels: [
            {
              title: "Step 1",
              statementMarkdown: problem.statementMarkdown,
              methods: isSQL ? [] : [problem.signature],
              examples: isSQL && problem.sql ? problem.examples : [],
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
          examples: staged ? [] : isSQL ? (problem.odyssey?.levels[0]?.examples ?? []) : [],
        },
        hiddenCases: staged ? [] : isSQL ? (content.odysseyHiddenCases?.[0] ?? []) : [],
        implementations: content.implementations.map((item) =>
          !isSQL && methods && !item.starterSource
            ? { ...item, starterSource: initialOdysseySource(methods, item.language) }
            : item,
        ),
        odysseyHiddenCases: staged ? [isSQL ? content.hiddenCases : []] : [],
      });
    }
    setPendingType(undefined);
  }
  return (
    <QuestionLanguage.Provider value={language}>
      <fieldset disabled={disabled} className="admin-fields question-authoring">
        <legend className="sr-only">Question fields</legend>
        <SessionDialog
          open={!!pendingType}
          onOpenChange={(open) => {
            if (!open) setPendingType(undefined);
          }}
          title="Change question type?"
          description="Changing type can remove stage content, test cases, schemas, or code from this edit."
        >
          <footer className="competitive-dialog-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setPendingType(undefined)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => pendingType && changeType(pendingType)}
            >
              Change type
            </button>
          </footer>
        </SessionDialog>
        <AuthoringTabs
          id={id}
          label="Question authoring"
          value={section}
          appearance="underline"
          onChange={(value) => {
            const next = tabs.find((tab) => tab.value === value);
            if (next) setSection(next.value);
          }}
          tabs={tabs}
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
                ...(!lockSlug && (!problem.slug || problem.slug === slug(problem.title))
                  ? { slug: slug(title) }
                  : {}),
              });
            }}
            onStatementChange={(statementMarkdown) => setProblem({ statementMarkdown })}
          />
          <div className="admin-overview-settings">
            <Field label="Question type">
              <SelectField
                label="Question type"
                value={questionType}
                disabled={disabled || invalidCases}
                options={questionTypes}
                onChange={(value) => {
                  const next = questionTypes.find((option) => option.value === value)?.value;
                  if (!next || next === questionType) return;
                  const hasCases =
                    problem.examples.length ||
                    content.hiddenCases.length ||
                    problem.odyssey?.levels.some(
                      (level) => level.examples.length || level.methods.length > 1,
                    ) ||
                    content.odysseyHiddenCases?.some((cases) => cases.length);
                  const changesDialect = next.startsWith("sql-") !== !!problem.sql;
                  const hasCode =
                    content.solutions.length ||
                    content.implementations.some(
                      (item) => item.starterSource || item.referenceSource,
                    );
                  if (
                    hasCases ||
                    problem.odyssey ||
                    (changesDialect &&
                      (hasCode || problem.sql?.tables?.length || problem.sql?.output?.length))
                  ) {
                    setPendingType(next);
                  } else {
                    changeType(next);
                  }
                }}
              />
            </Field>
            <div className="admin-field">
              <span>Difficulty</span>
              <DifficultySegments
                selected={[problem.difficulty]}
                single
                disabled={disabled}
                onChange={([difficulty]) => {
                  if (difficulty) setProblem({ difficulty });
                }}
              />
            </div>
          </div>
          <TopicField tags={problem.tags} onChange={(tags) => setProblem({ tags })} />
          <details className="authoring-options">
            <summary>Constraints ({problem.constraints.length})</summary>
            <ConstraintFields
              value={problem.constraints}
              signature={problem.sql ? undefined : problem.signature}
              disabled={disabled}
              onChange={(constraints) => setProblem({ constraints })}
            />
          </details>
          <details className="authoring-options">
            <summary>Advanced settings</summary>
            <div className="admin-field-pair">
              <Field label="Slug">
                <input
                  readOnly={lockSlug}
                  value={problem.slug}
                  onChange={(event) => setProblem({ slug: event.target.value })}
                />
              </Field>
              <LeetcodeIDField
                value={problem.leetcodeId ?? null}
                onChange={(leetcodeId) => setProblem({ leetcodeId })}
                onValidityChange={(invalid) => onValidityChange("leetcodeId", invalid)}
              />
            </div>
            <TopicField
              label="Companies"
              limit={64}
              tags={problem.companies ?? []}
              onChange={(companies) => setProblem({ companies })}
            />
            <Field label="Attribution">
              <input
                value={content.attribution}
                onChange={(event) => onChange({ ...content, attribution: event.target.value })}
              />
            </Field>
            <div className="authoring-limits">
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
        {(problem.sql || !problem.odyssey) && (
          <div
            role="tabpanel"
            id={`${id}-interface-panel`}
            aria-labelledby={`${id}-interface`}
            hidden={section !== "interface"}
          >
            {problem.sql ? (
              <SqlSchemaFields
                value={problem.sql}
                disabled={disabled}
                onChange={(sql) => setProblem({ sql })}
              />
            ) : (
              <>
                <fieldset className="admin-fields" disabled={disabled || invalidCases}>
                  <SignatureFields
                    disabled={disabled || invalidCases}
                    value={problem.signature}
                    onChange={(signature) => onChange(adaptSignature(content, signature))}
                    onValidityChange={onValidityChange}
                  />
                </fieldset>
                {invalidCases && (
                  <p className="admin-error">Fix test values before changing the method.</p>
                )}
              </>
            )}
          </div>
        )}
        <div
          role="tabpanel"
          id={`${id}-tests-panel`}
          aria-labelledby={`${id}-tests`}
          hidden={section !== "tests"}
        >
          {problem.sql && problem.odyssey ? (
            <SqlStages content={content} onChange={onChange} onValidityChange={onValidityChange} />
          ) : problem.odyssey ? (
            <AuthoringStages
              content={content}
              onChange={onChange}
              onValidityChange={onValidityChange}
            />
          ) : (
            <AuthoringCases
              key={
                problem.sql
                  ? "sql"
                  : JSON.stringify([
                      problem.signature.parameters.map((p) => p.type),
                      problem.signature.returnType,
                    ])
              }
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
          <div className="admin-authoring-compact">
            <Field label={problem.sql ? "Dialect" : "Language"}>
              <SelectField
                label={problem.sql ? "SQL dialect" : "Question language"}
                value={language}
                disabled={disabled}
                onChange={(value) => {
                  const next = languages.find((item) => item === value);
                  if (next) setLanguage(next);
                }}
                options={languages
                  .filter((value) =>
                    problem.sql ? value === "postgresql" : value !== "postgresql",
                  )
                  .map((value) => ({
                    value,
                    label: languageLabels[value],
                    leading: <LanguageLogo language={value} />,
                  }))}
              />
            </Field>
          </div>
          {[language].map((language) => {
            const index = content.implementations.findIndex((item) => item.language === language);
            const implementation = content.implementations[index];
            const solution = content.solutions.find((item) => item.language === language);
            return (
              <div key={language}>
                {language !== "python" && language !== "postgresql" && (
                  <div className="admin-check">
                    <span>Enable language</span>
                    <ToggleSwitch
                      label="Enable language"
                      checked={!!implementation}
                      disabled={disabled}
                      onChange={(checked) =>
                        onChange({
                          ...content,
                          implementations: checked
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
                          solutions: checked
                            ? content.solutions
                            : content.solutions.filter((item) => item.language !== language),
                        })
                      }
                    />
                  </div>
                )}
                {implementation && (
                  <>
                    <AuthoringCodeField
                      label={`${solutionLanguageLabel(language)} private judge reference`}
                      language={language}
                      source={implementation.referenceSource}
                      disabled={disabled}
                      onChange={(source) => setImplementation(index, { referenceSource: source })}
                    />
                    <div className="admin-check">
                      <span>Publish editorial solution</span>
                      <ToggleSwitch
                        label="Publish editorial solution"
                        disabled={disabled}
                        checked={!!solution}
                        onChange={(checked) =>
                          checked
                            ? setSolution(language, {})
                            : onChange({
                                ...content,
                                solutions: content.solutions.filter(
                                  (item) => item.language !== language,
                                ),
                              })
                        }
                      />
                    </div>
                    {solution && (
                      <details className="authoring-options">
                        <summary>Edit editorial solution</summary>
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
                      </details>
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
      <ProblemStatement
        problem={content.problem}
        beforeExamples={
          !content.problem.sql && (
            <section className="problem-section">
              <h2>{content.problem.odyssey ? "Methods" : "Method signature"}</h2>
              {(
                content.problem.odyssey?.levels.flatMap((level) => level.methods) ?? [
                  content.problem.signature,
                ]
              ).map((signature, index) => (
                <div key={index} className="authoring-signature-line">
                  <MethodSignature signature={signature} />
                </div>
              ))}
            </section>
          )
        }
      />
      {content.solutions.map((solution) => (
        <section key={solution.language}>
          <h2>{solutionLanguageLabel(solution.language as Language)} solution</h2>
          {solution.explanationMarkdown && (
            <StatementMarkdown source={solution.explanationMarkdown} />
          )}
          <CodeLiteral
            block
            source={solution.source}
            language={solution.language}
            className="editorial-source statement-code"
          />
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
