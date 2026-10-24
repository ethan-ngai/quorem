/** @file QuestionSetup.tsx @description Existing or custom interview questions with typed tests. @module interviews */
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InterviewQuestionInput, Signature } from "@quorem/contracts";
import { interviewRequest } from "./api";
import { SelectField } from "../../ui/SelectField";
import { languageLabels, type EditorLanguage } from "../editor/editorLanguages";
import { TestCases } from "../editor/components/TestCases";
import { blankQuestion } from "../admin/content";
import { SignatureFields } from "../admin/SignatureFields";
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
}: {
  onSubmit: (question: InterviewQuestionInput, title: string) => void;
  busy: boolean;
  label?: string;
  showTitle?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState("catalog");
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
  const [error, setError] = useState<string>();
  const catalog = useQuery({
    queryKey: ["interview-catalog", search],
    queryFn: () =>
      interviewRequest<{ items: { id: string; title: string; slug: string }[] }>(
        `/v1/problems?limit=100&q=${encodeURIComponent(search)}`,
      ),
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
      onSubmit(
        { language, problemVersionId: selected },
        title.trim() ||
          catalog.data?.items.find((item) => item.id === selected)?.title ||
          "Interview",
      );
      return;
    }
    try {
      if (!publicCases.length) {
        setError("Add at least one shared test.");
        return;
      }
      if (!customTitle.trim() || !starter.trim()) {
        setError("Add a question title and starter code.");
        return;
      }
      onSubmit(
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
    <form className="admin-fields" onSubmit={submit}>
      {showTitle && (
        <label className="admin-field">
          <span>Interview title</span>
          <input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
        </label>
      )}
      <div className="admin-field-pair">
        <label className="admin-field">
          <span>Question source</span>
          <SelectField
            label="Question source"
            value={mode}
            onChange={setMode}
            options={[
              { value: "catalog", label: "Existing question" },
              { value: "custom", label: "Custom question" },
            ]}
          />
        </label>
        <label className="admin-field">
          <span>Language</span>
          <SelectField
            label="Interview language"
            value={language}
            onChange={(value) => setLanguage(value as EditorLanguage)}
            options={Object.entries(languageLabels).map(([value, text]) => ({
              value,
              label: text,
            }))}
          />
        </label>
      </div>
      {mode === "catalog" ? (
        <>
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
        </>
      ) : (
        <>
          <label className="admin-field">
            <span>Question title</span>
            <input
              required
              maxLength={120}
              value={customTitle}
              onChange={(event) => setCustomTitle(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Statement</span>
            <textarea
              rows={4}
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Starter code</span>
            <textarea
              className="admin-code"
              rows={8}
              value={starter}
              onChange={(event) => setStarter(event.target.value)}
              spellCheck={false}
            />
          </label>
          <SignatureFields value={signature} onChange={updateSignature} />
          <CaseFields
            label="Shared tests"
            signature={signature}
            cases={publicCases}
            onChange={setPublicCases}
          />
          <CaseFields
            label="Interviewer-private tests"
            signature={signature}
            cases={privateCases}
            onChange={setPrivateCases}
          />
        </>
      )}
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      <footer className="competitive-dialog-actions">
        <span />
        <button className="button button-primary" disabled={busy}>
          {busy ? "Working…" : label}
        </button>
      </footer>
    </form>
  );
}

/** Shared practice case rail; expected values remain mandatory for authored test suites. */
function CaseFields({
  label,
  signature,
  cases,
  onChange,
}: {
  label: string;
  signature: Signature;
  cases: CustomCaseDraft[];
  onChange: (cases: CustomCaseDraft[]) => void;
}) {
  const problem = { ...blankQuestion().problem, signature };
  return (
    <section>
      <h3>{label}</h3>
      <div className="authoring-case-browser">
        <TestCases
          problem={problem}
          customMode
          drafts={cases}
          onDraftsChange={onChange}
          requiredExpected
          minimumCases={label === "Shared tests" ? 1 : 0}
        />
      </div>
    </section>
  );
}
