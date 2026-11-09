import { primarySignature, findPrimarySignature, blankSignature } from "@quorem/questions";
import { blankApproach } from "@quorem/questions";
import type { ReportAuthoringValidity, AuthoringIssue } from "./authoringValidation";
import { OdysseyIcon } from "../../ui/OdysseyIcon";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { DifficultySegments } from "../../ui/DifficultySegments";
import { QuestionLanguage } from "../editor/QuestionLanguage";
import { QuestionBasics } from "../../ui/QuestionBasics";
import { useId, useState } from "react";
import { adaptSignature } from "./authoringSignature";
import { TopicField } from "./AuthoringInputs";
import { GraphEncodingFields } from "./GraphEncodingFields";
import { SignatureFields } from "./SignatureFields";
import { SelectField } from "../../ui/SelectField";
import { SessionDialog } from "../../ui/SessionDialog";
import { SqlStages } from "./SqlStages";
import { SqlSchemaFields } from "./SqlSchemaFields";
import { LanguageLogo } from "../../ui/LanguageLogo";
import { AuthoringTabs } from "../../ui/AuthoringTabs";
import { AuthoringCases } from "./AuthoringCases";
import { AuthoringStages } from "./AuthoringStages";
import { CodeEditorialFields } from "./CodeEditorialFields";
import { AdvancedSettings } from "./AdvancedSettings";
import { ConstraintFields } from "./ConstraintFields";
import type { QuestionContent, Signature } from "@quorem/contracts";
import { SolutionDisplay } from "../editor/components/SolutionDisplay";
import type { EditorTheme } from "../editor/PythonEditor";
import { defaultEditorSchemes, type EditorScheme } from "../editor/editorSchemes";
import { MethodSignature } from "../editor/components/MethodSignature";
import { ProblemStatement } from "../editor/components/ProblemStatement";
import {
  Code2,
  FileText,
  FileCode2,
  Database,
  ListChecks,
  ChevronRight,
  Braces,
  FlaskConical,
} from "lucide-react";
import "../editor/components/editorial.css";
import "../odyssey/authoring.css";
import type { Language } from "./content";
import { questionLanguages } from "@quorem/questions";
import { languageLabels } from "../editor/editorLanguages";

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
const languages = [...questionLanguages(false), ...questionLanguages(true)];

function testShape(signature: Signature) {
  return JSON.stringify([
    signature.parameters.map(({ name, type }) => (signature.graphEncodings ? [name, type] : type)),
    signature.returnType,
    signature.graphEncodings,
  ]);
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
  const [language, setLanguage] = useState<Language>(problem.sql ? "postgresql" : "python");
  const [section, setSection] = useState<AuthoringSection>("question");
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
  function setProblem(patch: Partial<QuestionContent["problem"]>) {
    onChange({ ...content, problem: { ...problem, ...patch } });
  }
  function changeType(value: QuestionType) {
    const isSQL = value.startsWith("sql-");
    const staged = value === "staged" || value === "sql-staged";
    const signature = findPrimarySignature(problem) ?? blankSignature();
    const odyssey = staged
      ? {
          levels: [
            {
              title: "Step 1",
              statementMarkdown: problem.statementMarkdown,
              methods: isSQL ? [] : [signature],
              examples: isSQL && problem.sql ? problem.examples : [],
              hiddenCases: isSQL ? content.hiddenCases : [],
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
          signature: staged || isSQL ? undefined : signature,
          examples: [],
        },
        hiddenCases: [],
        canonicalApproachId: "default",
        approaches: [blankApproach(nextLanguage)],
      });
    } else {
      onChange({
        ...content,
        problem: {
          ...problem,
          odyssey,
          signature: staged || isSQL ? undefined : signature,
          examples: staged ? [] : isSQL ? (problem.odyssey?.levels[0]?.examples ?? []) : [],
        },
        hiddenCases: staged ? [] : isSQL ? (problem.odyssey?.levels[0]?.hiddenCases ?? []) : [],
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
                    content.problem.odyssey?.levels.some((level) => level.hiddenCases.length);
                  const changesDialect = next.startsWith("sql-") !== !!problem.sql;
                  const hasCode = content.approaches.some((approach) =>
                    approach.implementations.some((item) => item.source),
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
              <ListChecks size={15} aria-hidden="true" /> Constraints{" "}
              <span className="admin-count">{problem.constraints.length}</span>
              <ChevronRight size={14} className="disclosure-chevron" aria-hidden="true" />
            </summary>
            <ConstraintFields
              onValidityChange={(invalid, issues) =>
                onValidityChange("constraints", invalid, issues)
              }
              validationIssues={validationIssues}
              value={problem.constraints}
              signature={findPrimarySignature(problem)}
              disabled={disabled}
              onChange={(constraints) => setProblem({ constraints })}
            />
          </details>
          <AdvancedSettings
            content={content}
            lockSlug={lockSlug}
            onChange={onChange}
            onValidityChange={onValidityChange}
          />
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
                  value={primarySignature(problem)}
                  onChange={(signature) => {
                    if (
                      invalidCases &&
                      testShape(signature) !== testShape(primarySignature(problem))
                    )
                      setPendingSignature(signature);
                    else onChange(adaptSignature(content, signature));
                  }}
                  onValidityChange={onValidityChange}
                />
                <GraphEncodingFields
                  signature={primarySignature(problem)}
                  disabled={disabled}
                  onChange={(signature) => {
                    if (
                      invalidCases &&
                      testShape(signature) !== testShape(primarySignature(problem))
                    )
                      setPendingSignature(signature);
                    else onChange(adaptSignature(content, signature));
                  }}
                />
              </QuestionLanguage.Provider>
            )}
          </div>
        )}
        <div
          role="tabpanel"
          id={`${id}-tests-panel`}
          className="authoring-tests-panel"
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
              key={problem.sql ? "sql" : testShape(primarySignature(problem))}
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
          <CodeEditorialFields
            key={problem.sql ? "sql" : "coding"}
            content={content}
            language={language}
            onLanguageChange={setLanguage}
            disabled={disabled}
            onChange={onChange}
          />
        </div>
      </fieldset>
    </QuestionLanguage.Provider>
  );
}

export function PublicPreview({
  content,
  theme = "light",
  colorScheme = defaultEditorSchemes[theme],
  preferredLanguage,
}: {
  content: QuestionContent;
  theme?: EditorTheme;
  colorScheme?: EditorScheme;
  preferredLanguage?: string;
}) {
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
                  primarySignature(content.problem),
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
      <section className="problem-section" aria-label="Solution">
        <h2>Solution</h2>
        <SolutionDisplay
          approaches={content.approaches}
          canonicalApproachId={content.canonicalApproachId}
          preferredLanguage={preferredLanguage}
          theme={theme}
          colorScheme={colorScheme}
        />
      </section>
    </div>
  );
}
