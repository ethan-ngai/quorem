/** @file InterviewPage.tsx @description Shared coding workspace, role controls and private judging. @module interviews */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  InterviewSnapshot,
  InterviewQuestionInput,
  InterviewRole,
  Submission,
} from "@quorem/contracts";
import { GlobalNav } from "../navigation/GlobalNav";
import { useTheme } from "../editor/useTheme";
import { useLocalEditorPreferences } from "../settings/useLocalEditorPreferences";
import { PythonEditor, type PythonEditorHandle } from "../editor/PythonEditor";
import { languageLabels, type EditorLanguage } from "../editor/editorLanguages";
import { ProblemStatement } from "../editor/components/ProblemStatement";
import { ResultContent } from "../editor/components/ResultContent";
import { OdysseyPanel } from "../odyssey/OdysseyPanel";
import { useErrorNotification } from "../../ui/Notifications";
import { interviewRequest } from "./api";
import { createCollaboration, type CollaborationStatus } from "./collaboration";
import { QuestionSetup } from "./QuestionSetup";
import "../../styles/workspace.css";
import "./interviews.css";

/** Session metadata may refresh freely; document epochs change only after explicit recovery. */
export function InterviewPage({ id }: { id: string }) {
  const theme = useTheme();
  const query = useQuery({
    queryKey: ["interview", id],
    queryFn: () => interviewRequest<InterviewSnapshot>(`/v1/interviews/${id}`),
    refetchInterval: 2000,
    retry: false,
  });
  const [initial, setInitial] = useState<InterviewSnapshot>();
  useEffect(() => {
    if (query.data && !initial) setInitial(query.data);
  }, [query.data, initial]);
  return (
    <div className="app-root interview-app">
      <GlobalNav theme={theme.preference} onThemeChange={theme.setPreference} />
      {initial && query.data ? (
        <InterviewPad
          key={initial.document.epoch}
          initial={initial}
          snapshot={query.data}
          onOpenQuestion={() => setInitial(query.data)}
        />
      ) : (
        <main className="interview-invite">
          {query.isError ? (
            <>
              <h1>Interview unavailable</h1>
              <p>Open your invitation or sign in to restore access.</p>
              <button className="quiet-button" onClick={() => void query.refetch()}>
                Try again
              </button>
            </>
          ) : (
            <p role="status">Opening interview…</p>
          )}
        </main>
      )}
    </div>
  );
}

/** Owns one mounted collaboration authority version and preserves local pending edits. */
function InterviewPad({
  initial,
  snapshot,
  onOpenQuestion,
}: {
  initial: InterviewSnapshot;
  snapshot: InterviewSnapshot;
  onOpenQuestion: () => void;
}) {
  const id = snapshot.id;
  const theme = useTheme();
  const preferences = useLocalEditorPreferences();
  const queryClient = useQueryClient();
  const editor = useRef<PythonEditorHandle>(null);
  const [status, setStatus] = useState<CollaborationStatus>("connecting");
  const controller = useMemo(
    () => createCollaboration(id, initial.document, setStatus),
    [id, initial.document.epoch],
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const [members, setMembers] = useState(false);
  const [tab, setTab] = useState("code");
  const [admitted, setAdmitted] = useState<string>();
  const [copied, setCopied] = useState(false);
  const changed = snapshot.document.epoch !== initial.document.epoch;
  const interviewer = snapshot.role === "interviewer";
  const closed = snapshot.state === "closed";
  useErrorNotification(error);
  const sharedSubmission = snapshot.latestSubmissionId;
  const submissionId = sharedSubmission ?? admitted;
  const result = useQuery({
    queryKey: ["interview-result", id, submissionId],
    queryFn: () => interviewRequest<Submission>(`/v1/interviews/${id}/submissions/${submissionId}`),
    enabled: !!submissionId,
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.state ?? "") ? 600 : false,
  });
  const executing = busy || result.data?.state === "queued" || result.data?.state === "running";
  async function mutate(path: string, body: unknown = {}) {
    setBusy(true);
    setError(undefined);
    try {
      await interviewRequest(`/v1/interviews/${id}/${path}`, "POST", body, crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ["interview", id] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Interview update failed.");
    } finally {
      setBusy(false);
    }
  }
  async function execute(kind: "run" | "submit") {
    setBusy(true);
    setError(undefined);
    try {
      if (!(await controller.flush())) {
        setError("Reconnect and synchronize your changes before running.");
        return;
      }
      const submission = await interviewRequest<Submission>(
        `/v1/interviews/${id}/submissions`,
        "POST",
        { kind },
        crypto.randomUUID(),
      );
      setAdmitted(submission.id);
      queryClient.setQueryData(["interview-result", id, submission.id], submission);
      await queryClient.invalidateQueries({ queryKey: ["interview", id] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not run code.");
    } finally {
      setBusy(false);
    }
  }
  async function replace(question: InterviewQuestionInput) {
    setBusy(true);
    setError(undefined);
    try {
      await interviewRequest(`/v1/interviews/${id}/question`, "PUT", question, crypto.randomUUID());
      setSetup(false);
      await queryClient.invalidateQueries({ queryKey: ["interview", id] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not replace question.");
    } finally {
      setBusy(false);
    }
  }
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(editor.current?.getSource() ?? initial.document.source);
      setCopied(true);
    } catch {
      setError("Select and copy your code from the editor before opening the new question.");
    }
  }
  return (
    <main className="interview-workspace">
      <header className="interview-session-bar">
        <a href="/interviews" className="text-link">
          Interviews
        </a>
        <h1>{snapshot.title}</h1>
        <span className="interview-role">{interviewer ? "Interviewer" : "Interviewee"}</span>
        <div className="interview-session-actions">
          <button
            className="quiet-button"
            onClick={() => setMembers(!members)}
            aria-expanded={members}
          >
            {snapshot.members.length} participants
          </button>
          {interviewer && !closed && (
            <button className="quiet-button" onClick={() => setSetup(!setup)} aria-expanded={setup}>
              Change question
            </button>
          )}
          {snapshot.invitePath && !closed && (
            <button
              className="quiet-button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(new URL(snapshot.invitePath!, window.location.origin).href)
                  .then(() => setCopied(true))
                  .catch(() => setError("Could not copy invitation."));
              }}
            >
              {copied ? "Copied" : "Copy invite"}
            </button>
          )}
          {interviewer && !closed && (
            <button className="quiet-button" disabled={busy} onClick={() => void mutate("close")}>
              End interview
            </button>
          )}
        </div>
      </header>
      {members && (
        <section className="interview-members" aria-label="Participants">
          {snapshot.members.map((member) => (
            <div key={member.userId}>
              <span>
                {member.name}
                {member.guest ? " · Guest" : ""}
              </span>
              {interviewer && !closed && member.userId !== snapshot.hostId ? (
                <>
                  <select
                    aria-label={`Role for ${member.name}`}
                    value={member.role}
                    disabled={busy}
                    onChange={(event) =>
                      void mutate("members", {
                        userId: member.userId,
                        role: event.target.value as InterviewRole,
                      })
                    }
                  >
                    <option value="interviewer">Interviewer</option>
                    <option value="interviewee">Interviewee</option>
                  </select>
                  <button
                    className="quiet-button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(`members/${encodeURIComponent(member.userId)}/remove`)
                    }
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span>{member.role}</span>
              )}
            </div>
          ))}
        </section>
      )}
      {setup && (
        <section className="interview-question-change">
          <h2>Replace question</h2>
          <p>This starts a new shared document. Copy any code you want to keep first.</p>
          <QuestionSetup
            showTitle={false}
            onSubmit={(question) => void replace(question)}
            busy={busy}
            label="Replace question and code"
          />
        </section>
      )}
      {(changed || status === "replaced") && (
        <div className="interview-recovery" role="alert">
          <span>The shared question changed. Preserve local code before continuing.</span>
          <button className="quiet-button" onClick={() => void copyCode()}>
            Copy my code
          </button>
          <button className="button button-secondary" onClick={onOpenQuestion}>
            Open new question
          </button>
        </div>
      )}
      {closed && (
        <p className="interview-recovery" role="status">
          Interview ended. Code and results remain available.
        </p>
      )}
      {status === "offline" && (
        <div className="interview-recovery" role="status">
          Connection interrupted. Edits stay in this tab and retry automatically. Keep this tab
          open.
        </div>
      )}
      <nav className="interview-mobile-tabs" aria-label="Interview panes">
        {["question", "code", "results"].map((value) => (
          <button
            className="quiet-button"
            key={value}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {value[0]!.toUpperCase() + value.slice(1)}
          </button>
        ))}
      </nav>
      <div className="interview-panes" data-tab={tab}>
        <section className="interview-question" aria-label="Interview question">
          {snapshot.question.progress ? (
            <OdysseyPanel
              progress={snapshot.question.progress}
              title={snapshot.question.problem.title}
              introduction={snapshot.question.problem.statementMarkdown}
            />
          ) : (
            <ProblemStatement problem={initial.question.problem} />
          )}
          {interviewer && snapshot.question.privateCases && (
            <details className="interview-private">
              <summary>Interviewer-private tests ({snapshot.question.privateCases.length})</summary>
              <pre>
                <code>{JSON.stringify(snapshot.question.privateCases, null, 2)}</code>
              </pre>
            </details>
          )}
        </section>
        <div className="interview-solution">
          <section className="interview-code" aria-label="Shared code">
            <div className="code-toolbar">
              <span>
                {languageLabels[initial.question.language as EditorLanguage] ??
                  initial.question.language}
              </span>
            </div>
            <PythonEditor
              ref={editor}
              documentKey={`interview:${id}:${initial.document.epoch}`}
              documentUri={`file:///interviews/${id}/solution`}
              initialSource={initial.document.source}
              language={initial.question.language as EditorLanguage}
              theme={theme.theme}
              colorScheme={preferences.editorScheme}
              fontSize={preferences.fontSize}
              tabSize={preferences.tabSize}
              wrap={preferences.wrap}
              readOnly={closed || changed}
              collaborationExtension={controller.extension}
              onSourceChange={() => {}}
            />
          </section>
          <section className="interview-results" aria-label="Shared test results">
            <ResultContent submission={result.data} busy={busy} />
            {result.isError && (
              <p role="alert">
                Could not load results.{" "}
                <button className="quiet-button" onClick={() => void result.refetch()}>
                  Retry
                </button>
              </p>
            )}
          </section>
        </div>
      </div>
      <footer className="interview-execution">
        <span>
          {snapshot.question.progress
            ? `Level ${snapshot.question.progress.level} · cumulative tests`
            : "Shared code and results"}
        </span>
        <div>
          <button
            className="button button-secondary"
            disabled={executing || closed || changed || status !== "connected"}
            onClick={() => void execute("run")}
          >
            Run
          </button>
          <button
            className="button button-primary"
            disabled={executing || closed || changed || status !== "connected"}
            onClick={() => void execute("submit")}
          >
            {executing ? "Running…" : "Submit"}
          </button>
        </div>
      </footer>
    </main>
  );
}
