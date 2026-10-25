import { InterviewMonitoringControls } from "./InterviewMonitoringControls";
import type { InterviewMonitoring } from "@quorem/contracts";
import "../../ui/result-tabs.css";
import { QuestionHintsControls } from "../../ui/QuestionHintsControls";
import type { QuestionHints } from "@quorem/contracts";
import { QuestionBasics } from "../../ui/QuestionBasics";
/** @file QuestionSetup.tsx @description Existing or custom interview questions with typed tests. @module interviews */
import { useId, useRef, useState, type FormEvent } from "react";
import { AuthoringTabs } from "../../ui/AuthoringTabs";
import { useSession } from "../auth/session";
import { useQuery } from "@tanstack/react-query";
import type { InterviewQuestionInput, Signature } from "@quorem/contracts";
import { interviewRequest } from "./api";
import { LanguageLogo } from "../../ui/LanguageLogo";
import { SelectField } from "../../ui/SelectField";
import { languageLabels, type EditorLanguage } from "../editor/editorLanguages";
import { TestCases } from "../editor/components/TestCases";
import { blankQuestion } from "../admin/content";
import { SignatureFields } from "../admin/SignatureFields";
import { initialOdysseySource } from "../odyssey/methodStubs";
import { QuestionLanguage } from "../editor/QuestionLanguage";
import { StageAuthoring } from "../odyssey/StageAuthoring";
import { firstStage, parseStages, type StageDraft } from "../odyssey/stageDrafts";
import { Icon } from "../../ui/Icon";
import "../odyssey/authoring.css";
import { ProblemPicker } from "../practice/ProblemPicker";
import "../admin/admin.css";
import { createCustomDraft, parseCustomDrafts, type CustomCaseDraft } from "../editor/customCases";
import "../editor/components/customCases.css";

const initialSignature: Signature = {
  className: "Solution",
  methodName: "solve",
  parameters: [{ name: "value", type: "int" }],
  returnType: "int",
};
function newCase(signature: Signature): CustomCaseDraft {
  return { ...createCustomDraft({ ...blankQuestion().problem, signature }), expectedEnabled: true };
}

/** Keeps input drafts intact until explicit, validated submission. */
export function QuestionSetup({
  onSubmit,
  busy,
  label = "Create interview",
  showTitle = true,
  initialHints = {},
  showHints = true,
}: {
  onSubmit: (
    question: InterviewQuestionInput,
    title: string,
    monitoring?: InterviewMonitoring,
  ) => void;
  busy: boolean;
  label?: string;
  showTitle?: boolean;
  initialHints?: QuestionHints;
  showHints?: boolean;
}) {
  const [monitoring, setMonitoring] = useState<InterviewMonitoring>({});
  const [hints, setHints] = useState<QuestionHints>(initialHints);
  const submitQuestion = (question: InterviewQuestionInput, title: string) =>
    onSubmit(
      { ...question, ...(showHints ? { hints } : {}) },
      title,
      showHints ? monitoring : undefined,
    );
  const session = useSession();
  const canAuthor =
    session.data?.user.role === "admin" || !!session.data?.capabilities?.authorCustomQuestions;
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState("catalog");
  const [authorSection, setAuthorSection] = useState("question");
  const sectionId = useId();
  const [language, setLanguage] = useState<EditorLanguage>("python");
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [starter, setStarter] = useState(
    "class Solution:\n    def solve(self, value: int) -> int:\n        pass\n",
  );
  const [signature, setSignature] = useState<Signature>(initialSignature);
  const [publicCases, setPublicCases] = useState<CustomCaseDraft[]>(() => [
    newCase(initialSignature),
  ]);
  const [privateCases, setPrivateCases] = useState<CustomCaseDraft[]>(() => [
    newCase(initialSignature),
  ]);
  const [stages, setStages] = useState<StageDraft[]>(() => [firstStage(initialSignature)]);
  const stagedInitialized = useRef(false);
  const [invalidTypes, setInvalidTypes] = useState<Record<string, boolean>>({});
  const [invalidSingleTypes, setInvalidSingleTypes] = useState<Record<string, boolean>>({});
  const firstMethods = stages[0]?.methods.map((method) => method.signature) ?? [];
  const starterIsDefault =
    starter === "class Solution:\n    def solve(self, value: int) -> int:\n        pass\n" ||
    starter === initialOdysseySource(firstMethods, language);
  function changeStages(next: StageDraft[]) {
    if (starterIsDefault)
      setStarter(
        initialOdysseySource(next[0]?.methods.map((method) => method.signature) ?? [], language),
      );
    setStages(next);
  }
  function chooseMode(next: string) {
    if (next === "staged" && starterIsDefault)
      setStarter(
        initialOdysseySource(stagedInitialized.current ? firstMethods : [signature], language),
      );
    if (next === "staged" && !stagedInitialized.current) {
      setStages([
        firstStage(signature, "", publicCases, privateCases.length ? privateCases : undefined),
      ]);
      stagedInitialized.current = true;
    }
    setMode(next);
  }
  const [error, setError] = useState<string>();
  const catalog = useQuery({
    queryKey: ["interview-catalog", session.data?.user.id, search],
    queryFn: () =>
      interviewRequest<{
        items: { id: string; title: string; slug: string; complexityLanguages?: string[] }[];
      }>(`/v1/problems?limit=100&q=${encodeURIComponent(search)}`),
    enabled: mode === "catalog",
  });
  function updateSignature(next: Signature) {
    setSignature(next);
    const defaults = newCase(next);
    const adapt = (cases: CustomCaseDraft[]) =>
      cases.map((test) => ({
        ...test,
        args: next.parameters.map((parameter, index) =>
          parameter.type === signature.parameters[index]?.type
            ? (test.args[index] ?? defaults.args[index]!)
            : defaults.args[index]!,
        ),
        expected: next.returnType === signature.returnType ? test.expected : defaults.expected,
      }));
    setPublicCases(adapt);
    setPrivateCases(adapt);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    if (mode === "catalog") {
      if (!selected) {
        setError("Choose a question.");
        return;
      }
      submitQuestion(
        { language, problemVersionId: selected },
        title.trim() ||
          catalog.data?.items.find((item) => item.id === selected)?.title ||
          "Interview",
      );
      return;
    }
    try {
      if (!canAuthor) throw new Error("Custom question access required.");
      if (mode === "staged") {
        if (Object.values(invalidTypes).some(Boolean))
          throw new Error("Fix the highlighted method types before creating the question.");
        if (!customTitle.trim() || !starter.trim()) {
          setAuthorSection("question");
          throw new Error("Add a question title and starter code.");
        }
        const staged = parseStages(stages);
        submitQuestion(
          {
            language,
            custom: {
              title: customTitle,
              statementMarkdown: statement,
              starterSource: starter,
              signature: stages[0]!.methods[0]!.signature,
              publicCases: staged.odyssey.levels[0]!.examples,
              privateCases: [],
              ...staged,
            },
          },
          title.trim() || customTitle,
        );
        return;
      }
      if (Object.values(invalidSingleTypes).some(Boolean)) {
        setAuthorSection("question");
        throw new Error("Fix the highlighted method types before creating the question.");
      }
      if (!publicCases.length) {
        setError("Add at least one shared test.");
        return;
      }
      if (!customTitle.trim() || !starter.trim()) {
        setAuthorSection("question");
        setError("Add a question title and starter code.");
        return;
      }
      submitQuestion(
        {
          language,
          custom: {
            title: customTitle,
            statementMarkdown: statement,
            starterSource: starter,
            signature,
            publicCases: parseCustomDrafts(publicCases, signature),
            privateCases: privateCases.length ? parseCustomDrafts(privateCases, signature) : [],
          },
        },
        title.trim() || customTitle,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Check your test values before continuing.",
      );
    }
  }
  return (
    <QuestionLanguage.Provider value={language}>
      <form className="admin-fields question-authoring" onSubmit={submit}>
        {showTitle && (
          <label className="admin-field">
            <span>Interview title</span>
            <input
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
        )}
        <div className="admin-field-pair">
          <label className="admin-field">
            <span>Question source</span>
            <SelectField
              label="Question source"
              value={mode}
              onChange={chooseMode}
              options={[
                { value: "catalog", label: "Existing question" },
                ...(canAuthor
                  ? [
                      { value: "custom", label: "Custom question" },
                      { value: "staged", label: "Custom multi-stage question" },
                    ]
                  : []),
              ]}
            />
          </label>
          <label className="admin-field">
            <span>Language</span>
            <SelectField
              label="Interview language"
              value={language}
              onChange={(value) => {
                if (mode === "staged" && starterIsDefault)
                  setStarter(initialOdysseySource(firstMethods, value as EditorLanguage));
                setLanguage(value as EditorLanguage);
              }}
              options={Object.entries(languageLabels).map(([value, text]) => ({
                value,
                label: text,
                leading: <LanguageLogo language={value as EditorLanguage} />,
              }))}
            />
          </label>
        </div>
        {mode !== "catalog" && <p>Saved to your private library.</p>}
        {mode !== "catalog" && (
          <AuthoringTabs
            id={sectionId}
            label="Question authoring"
            value={authorSection}
            onChange={setAuthorSection}
            tabs={[
              { value: "question", label: "Question" },
              { value: "tests", label: mode === "staged" ? "Steps & tests" : "Tests" },
            ]}
          />
        )}
        <fieldset
          className="admin-fields"
          hidden={mode !== "catalog"}
          disabled={mode !== "catalog"}
        >
          <label className="admin-field">
            <span>Problem</span>
            <ProblemPicker
              items={catalog.data?.items ?? []}
              value={selected}
              onChange={(value) => setSelected(value ?? "")}
              onSearchChange={setSearch}
              disabled={catalog.isPending && !catalog.data}
            />
          </label>
          {catalog.isError && (
            <p role="alert">
              Could not load questions.{" "}
              <button type="button" className="quiet-button" onClick={() => void catalog.refetch()}>
                Retry
              </button>
            </p>
          )}
        </fieldset>
        <fieldset
          className="admin-fields"
          hidden={mode === "catalog"}
          disabled={mode === "catalog"}
        >
          <fieldset
            className="admin-fields"
            hidden={authorSection !== "question"}
            disabled={authorSection !== "question"}
            id={`${sectionId}-question-panel`}
            role="tabpanel"
            aria-labelledby={`${sectionId}-question`}
          >
            <QuestionBasics
              title={customTitle}
              statement={statement}
              starter={starter}
              staged={mode === "staged"}
              required
              onTitleChange={setCustomTitle}
              onStatementChange={setStatement}
              onStarterChange={setStarter}
            />
          </fieldset>
          <fieldset
            className="admin-fields"
            hidden={mode !== "staged" || authorSection !== "tests"}
            disabled={mode !== "staged" || authorSection !== "tests"}
            id={mode === "staged" ? `${sectionId}-tests-panel` : undefined}
            role="tabpanel"
            aria-labelledby={`${sectionId}-tests`}
          >
            <StageAuthoring
              value={stages}
              onChange={changeStages}
              onValidityChange={(id, invalid) =>
                setInvalidTypes((current) =>
                  current[id] === invalid ? current : { ...current, [id]: invalid },
                )
              }
            />
          </fieldset>
          <fieldset
            className="admin-fields"
            hidden={mode === "staged"}
            disabled={mode === "staged"}
          >
            <fieldset
              className="admin-fields"
              hidden={authorSection !== "question"}
              disabled={authorSection !== "question"}
            >
              <SignatureFields
                value={signature}
                onChange={updateSignature}
                onValidityChange={(id, invalid) =>
                  setInvalidSingleTypes((current) =>
                    current[id] === invalid ? current : { ...current, [id]: invalid },
                  )
                }
              />
            </fieldset>
            <fieldset
              className="admin-fields"
              hidden={authorSection !== "tests"}
              disabled={authorSection !== "tests"}
              id={mode !== "staged" ? `${sectionId}-tests-panel` : undefined}
              role="tabpanel"
              aria-labelledby={`${sectionId}-tests`}
            >
              <QuestionTests
                signature={signature}
                publicCases={publicCases}
                privateCases={privateCases}
                onPublicChange={setPublicCases}
                onPrivateChange={setPrivateCases}
              />
            </fieldset>
          </fieldset>
        </fieldset>
        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}
        {showHints && (
          <InterviewMonitoringControls
            value={monitoring}
            onChange={setMonitoring}
            disabled={busy}
          />
        )}
        {showHints && (
          <QuestionHintsControls
            complexityAvailable={
              mode === "catalog" &&
              !!catalog.data?.items
                .find((item) => item.id === selected)
                ?.complexityLanguages?.includes(language)
            }
            value={hints}
            onChange={setHints}
            disabled={busy}
          />
        )}
        <footer className="competitive-dialog-actions">
          <span />
          <button className="button button-primary" disabled={busy}>
            {busy ? "Working…" : label}
          </button>
        </footer>
      </form>
    </QuestionLanguage.Provider>
  );
}

/** Both collections share one bounded authoring surface; drafts survive tab switches. */
function QuestionTests({
  signature,
  publicCases,
  privateCases,
  onPublicChange,
  onPrivateChange,
}: {
  signature: Signature;
  publicCases: CustomCaseDraft[];
  privateCases: CustomCaseDraft[];
  onPublicChange: (value: CustomCaseDraft[]) => void;
  onPrivateChange: (value: CustomCaseDraft[]) => void;
}) {
  const [collection, setCollection] = useState("public");
  const [selection, setSelection] = useState<Record<string, string | undefined>>({});
  const id = useId();
  const problem = { ...blankQuestion().problem, signature };
  return (
    <div className="authoring-test-collections">
      <div className="result-tabs" role="tablist" aria-label="Question tests">
        {(["public", "private"] as const).map((tab, index) => (
          <button
            type="button"
            role="tab"
            key={tab}
            id={`${id}-${tab}`}
            aria-controls={`${id}-cases`}
            aria-selected={collection === tab}
            tabIndex={collection === tab ? 0 : -1}
            onClick={() => setCollection(tab)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "public"
                  : event.key === "End"
                    ? "private"
                    : index === 0
                      ? "private"
                      : "public";
              setCollection(next);
              document.getElementById(`${id}-${next}`)?.focus();
            }}
          >
            <Icon name={tab === "private" ? "lock" : "samples"} />
            {tab === "public" ? "Test cases" : "Private tests"}
          </button>
        ))}
      </div>
      <div
        className="authoring-case-browser"
        id={`${id}-cases`}
        role="tabpanel"
        aria-labelledby={`${id}-${collection}`}
      >
        <TestCases
          key={collection}
          selectedCustomId={selection[collection]}
          onSelectCustomCase={(id) => setSelection((current) => ({ ...current, [collection]: id }))}
          problem={problem}
          customMode
          drafts={collection === "public" ? publicCases : privateCases}
          onDraftsChange={collection === "public" ? onPublicChange : onPrivateChange}
          requiredExpected
          minimumCases={collection === "public" ? 1 : 0}
        />
      </div>
    </div>
  );
}
