import type { ReportAuthoringValidity, AuthoringIssue } from "./authoringValidation";
import { OdysseyIcon } from "../../ui/OdysseyIcon";
import { TextInput } from "../../ui/TextControl";
import { MarkdownField } from "../../ui/MarkdownField";
import { SegmentedControl } from "../../ui/SegmentedControl";
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
import type { QuestionContent, ProblemVersion, Signature } from "@quorem/contracts";
import { CodeLiteral } from "../editor/components/CodeLiteral";
import { MethodSignature } from "../editor/components/MethodSignature";
import { ProblemStatement } from "../editor/components/ProblemStatement";
import { ComplexityDetails } from "../editor/components/EditorialPanel";
import { complexityMath } from "../editor/complexityMarkup";
import {
  Clock3,
  Code2,
  FileText,
  FileCode2,
  Database,
  LockKeyhole,
  ListFilter,
  Settings2,
  ChevronRight,
  Braces,
  FlaskConical,
} from "lucide-react";
import { inlineStatement, StatementMarkdown } from "../editor/components/StatementMarkdown";
import "../editor/components/editorial.css";
import "../odyssey/authoring.css";
import { revisions, type Language } from "./content";
import { languageLabels, solutionLanguageLabel } from "../editor/editorLanguages";

type QuestionType = "single" | "staged" | "sql-single" | "sql-staged";
function QuestionTypeControl({
  value,
  disabled,
  onChange,
}: {
  value: QuestionType;
  disabled: boolean;
  onChange: (value: QuestionType) => void;
}) {
  const sql = value.startsWith("sql-");
  const staged = value.endsWith("staged");
  return (
    <div className="admin-type-choices">
      <SegmentedControl
        label="Question type"
        value={sql ? "sql" : "coding"}
        disabled={disabled}
        options={[
          { value: "coding", label: "Coding", icon: <Code2 size={14} aria-hidden="true" /> },
          { value: "sql", label: "SQL", icon: <Database size={14} aria-hidden="true" /> },
        ]}
        onChange={(type) =>
          onChange(
            type === "sql" ? (staged ? "sql-staged" : "sql-single") : staged ? "staged" : "single",
          )
        }
      />
      <SegmentedControl
        label="Question structure"
        iconOnly
        value={staged ? "staged" : "single"}
        disabled={disabled}
        options={[
          { value: "single", label: "Single", icon: <FileCode2 size={16} aria-hidden="true" /> },
          { value: "staged", label: "Multi-stage (Odyssey)", icon: <OdysseyIcon /> },
        ]}
        onChange={(structure) =>
          onChange(sql ? (structure === "staged" ? "sql-staged" : "sql-single") : structure)
        }
      />
    </div>
  );
}
type PreviewLanguage = Exclude<Language, "postgresql">;

type AuthoringSection = "question" | "interface" | "tests" | "solutions";
const languages = Object.keys(revisions).filter((key): key is Language =>
  Object.hasOwn(revisions, key),
);

function testShape(signature: Signature) {
  return JSON.stringify([signature.parameters.map(({ type }) => type), signature.returnType]);
}

export function QuestionFields({
  content,
  previewLanguage = "python",
  onPreviewLanguageChange,
  disabled,
  invalidCases = false,
  lockSlug = false,
  onChange,
  onValidityChange,
  validationIssues = [],
}: {
  content: QuestionContent;
  validationIssues?: readonly AuthoringIssue[];
  previewLanguage?: PreviewLanguage;
  onPreviewLanguageChange?: (language: PreviewLanguage) => void;
  disabled: boolean;
  invalidCases?: boolean;
  lockSlug?: boolean;
  onChange: (content: QuestionContent) => void;
  onValidityChange: ReportAuthoringValidity;
}) {
  const problem = content.problem;
  const [codeSection, setCodeSection] = useState<"reference" | "editorial">("editorial");
  const [section, setSection] = useState<AuthoringSection>("question");
  const [language, setLanguage] = useState<Language>(content.problem.sql ? "postgresql" : "python");
  const id = useId();
  const [pendingType, setPendingType] = useState<QuestionType>();
  const [pendingSignature, setPendingSignature] = useState<Signature>();
  const questionType = problem.sql
    ? problem.odyssey
      ? "sql-staged"
      : "sql-single"
    : problem.odyssey
      ? "staged"
      : "single";
  const tabs = [
    { value: "question", label: "Overview", icon: <FileText aria-hidden="true" /> },
    ...(problem.sql || !problem.odyssey
      ? [
          {
            value: "interface",
            label: problem.sql ? "Schema" : "Signature",
            icon: problem.sql ? <Database aria-hidden="true" /> : <Braces aria-hidden="true" />,
          } as const,
        ]
      : []),
    {
      value: "tests",
      label: problem.odyssey ? "Steps & tests" : "Tests",
      icon: <FlaskConical aria-hidden="true" />,
    },
    { value: "solutions", label: "Code & editorial", icon: <Code2 aria-hidden="true" /> },
  ] as const;
  const previewLanguagePicker = onPreviewLanguageChange && (
    <SelectField
      iconOnly
      label="Signature preview language"
      value={previewLanguage}
      disabled={disabled}
      options={languages
        .filter((value) => value !== "postgresql")
        .map((value) => ({
          value,
          label: languageLabels[value],
          leading: <LanguageLogo language={value} />,
        }))}
      onChange={(value) => {
        const next = languages.find((language) => language === value);
        if (next && next !== "postgresql") onPreviewLanguageChange(next);
      }}
    />
  );
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
        <SessionDialog
          open={!!pendingSignature}
          onOpenChange={(open) => {
            if (!open) setPendingSignature(undefined);
          }}
          title="Change the test types?"
          description="Changing the signature reloads examples and private tests from their last valid values. Unfinished test edits will be lost."
        >
          <footer className="competitive-dialog-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setPendingSignature(undefined)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                if (!pendingSignature) return;
                onChange(adaptSignature(content, pendingSignature));
                setPendingSignature(undefined);
              }}
            >
              Change types
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
            <div className="admin-field">
              <span>Question type</span>
              <QuestionTypeControl
                value={questionType}
                disabled={disabled}
                onChange={(value) => {
                  const next = value;
                  if (next === questionType) return;
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
                    invalidCases ||
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
            </div>
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
          <details className="disclosure authoring-options">
            <summary>
              <ListFilter size={15} aria-hidden="true" /> Constraints{" "}
              <span className="admin-count">{problem.constraints.length}</span>
              <ChevronRight size={14} className="disclosure-chevron" aria-hidden="true" />
            </summary>
            <ConstraintFields
              onValidityChange={(invalid, issues) =>
                onValidityChange("constraints", invalid, issues)
              }
              validationIssues={validationIssues}
              value={problem.constraints}
              signature={problem.sql ? undefined : problem.signature}
              disabled={disabled}
              onChange={(constraints) => setProblem({ constraints })}
            />
          </details>
          <details className="disclosure authoring-options">
            <summary>
              <Settings2 size={15} aria-hidden="true" /> Advanced settings
              <ChevronRight size={14} className="disclosure-chevron" aria-hidden="true" />
            </summary>
            <div className="admin-field-pair">
              <Field label="Slug">
                <TextInput
                  mono
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
              <TextInput
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
              <QuestionLanguage.Provider value={previewLanguage}>
                <SignatureFields
                  previewControl={previewLanguagePicker}
                  disabled={disabled}
                  value={problem.signature}
                  onChange={(signature) => {
                    if (invalidCases && testShape(signature) !== testShape(problem.signature))
                      setPendingSignature(signature);
                    else onChange(adaptSignature(content, signature));
                  }}
                  onValidityChange={onValidityChange}
                />
              </QuestionLanguage.Provider>
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
            <QuestionLanguage.Provider value={previewLanguage}>
              <div className="admin-signature-preview-language">{previewLanguagePicker}</div>
              <AuthoringStages
                content={content}
                onChange={onChange}
                onValidityChange={onValidityChange}
              />
            </QuestionLanguage.Provider>
          ) : (
            <AuthoringCases
              key={problem.sql ? "sql" : testShape(problem.signature)}
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
          <div className="admin-code-toolbar">
            <SegmentedControl
              label="Code content"
              value={codeSection}
              onChange={setCodeSection}
              options={[
                {
                  value: "reference",
                  label: "Judge reference",
                  icon: <LockKeyhole size={14} aria-hidden="true" />,
                },
                {
                  value: "editorial",
                  label: "Public editorial",
                  icon: <FileText size={14} aria-hidden="true" />,
                },
              ]}
            />
            <SelectField
              label={problem.sql ? "SQL dialect" : "Question language"}
              value={language}
              disabled={disabled}
              onChange={(value) => {
                const next = languages.find((item) => item === value);
                if (next) setLanguage(next);
              }}
              options={languages
                .filter((value) => (problem.sql ? value === "postgresql" : value !== "postgresql"))
                .map((value) => ({
                  value,
                  label: languageLabels[value],
                  leading: <LanguageLogo language={value} />,
                }))}
            />
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
                    <div hidden={codeSection !== "reference"}>
                      <p className="admin-authoring-hint">
                        Private implementation used to verify test results.
                      </p>
                      <AuthoringCodeField
                        label={`${solutionLanguageLabel(language)} private judge reference`}
                        language={language}
                        source={implementation.referenceSource}
                        disabled={disabled}
                        onChange={(source) => setImplementation(index, { referenceSource: source })}
                      />
                    </div>
                    <div hidden={codeSection !== "editorial"}>
                      <div className="admin-editorial-header">
                        <h3 className="admin-editorial-heading">
                          <FileText size={15} aria-hidden="true" /> Publish editorial
                        </h3>
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
                        <div className="admin-editorial-fields">
                          <AuthoringCodeField
                            label={`${solutionLanguageLabel(language)} editorial code`}
                            language={language}
                            source={solution.source}
                            disabled={disabled}
                            onChange={(source) => setSolution(language, { source })}
                          />
                          <MarkdownField
                            label="Explanation"
                            value={solution.explanationMarkdown}
                            onChange={(explanationMarkdown) =>
                              setSolution(language, { explanationMarkdown })
                            }
                          />
                          <section className="admin-editorial-complexity">
                            <h3 className="admin-editorial-heading">
                              <Clock3 size={15} /> Complexity
                            </h3>
                            <div className="admin-field-pair">
                              {(
                                [
                                  ["timeComplexity", "Time"],
                                  ["spaceComplexity", "Auxiliary space"],
                                ] as const
                              ).map(([field, label]) => (
                                <Field label={label} key={field}>
                                  <TextInput
                                    mono
                                    value={solution[field]}
                                    placeholder="O(n)"
                                    onChange={(event) =>
                                      setSolution(language, { [field]: event.target.value })
                                    }
                                  />
                                  {solution[field].trim() && (
                                    <span className="admin-complexity-preview">
                                      {inlineStatement(complexityMath(solution[field]))}
                                    </span>
                                  )}
                                </Field>
                              ))}
                            </div>
                            <MarkdownField
                              label="Complexity notes"
                              compact
                              value={solution.complexityNotes}
                              onChange={(complexityNotes) =>
                                setSolution(language, { complexityNotes })
                              }
                            />
                          </section>
                        </div>
                      )}
                    </div>
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
                  <MethodSignature signature={signature} showDocumentation />
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
          {(solution.timeComplexity || solution.spaceComplexity || solution.complexityNotes) && (
            <ComplexityDetails value={solution} />
          )}
        </section>
      ))}
    </div>
  );
}
