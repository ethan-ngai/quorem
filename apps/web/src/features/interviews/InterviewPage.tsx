/** @file InterviewPage.tsx @description Shared coding workspace, role controls and private judging. @module interviews */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { InterviewSnapshot, InterviewQuestionInput, Submission } from "@quorem/contracts";
import { GlobalNav } from "../navigation/GlobalNav";
import { useTheme } from "../editor/useTheme";
import { useLocalEditorPreferences } from "../settings/useLocalEditorPreferences";
import { PythonEditor, type PythonEditorHandle } from "../editor/PythonEditor";
import { languageFileNames, type EditorLanguage } from "../editor/editorLanguages";
import { ProblemStatement } from "../editor/components/ProblemStatement";
import { OdysseyPanel } from "../odyssey/OdysseyPanel";
import { useErrorNotification } from "../../ui/Notifications";
import { interviewRequest } from "./api";
import { createCollaboration, type CollaborationStatus } from "./collaboration";
import { QuestionSetup } from "./QuestionSetup";
import type { DevelopmentIdentity } from "@quorem/contracts";
import { useSession } from "../auth/session";
import { useHotkey } from "@tanstack/react-hotkeys";
import { workspaceShortcuts } from "../editor/workspaceShortcuts";
import { useIntelligence } from "../editor/useIntelligence";
import { WorkspaceLayout, type WorkspacePanel } from "../editor/components/WorkspaceLayout";
import { SolutionToolbar } from "../editor/components/SolutionToolbar";
import { InterviewTests } from "./InterviewTests";
import { InterviewParticipants } from "./InterviewParticipants";
import { InterviewInvitations } from "./InterviewInvitations";
import { OdysseyStepper } from "../odyssey/OdysseyStepper";
import { InterviewLifecycleDialog } from "./InterviewLifecycleDialog";
import { ArrowLeft } from "lucide-react";
import { ExecutionActions } from "../editor/components/ExecutionActions";
import { Icon } from "../editor/components/Icon";
import { Tooltip } from "../editor/components/Tooltip";
import { SessionDialog } from "../../ui/SessionDialog";
import { WorkspaceRecovery } from "../../ui/WorkspaceRecovery";
import "../../styles/workspace.css";
const keepSource = () => {};
function resultAccessFor(snapshot: InterviewSnapshot) {
  return snapshot.role === "interviewer"
    ? "interviewer"
    : `${snapshot.role}:${(snapshot.question.revealedCases ?? [])
        .map((test) => test.id)
        .sort()
        .join(",")}`;
}
import "./collaboration.css";
import "./session-controls.css";

/** Session metadata may refresh freely; document epochs change only after explicit recovery. */
export function InterviewPage({ id }: { id: string }) {
  const theme = useTheme();
  const query = useQuery({
    queryKey: ["interview", id],
    queryFn: () => interviewRequest<InterviewSnapshot>(`/v1/interviews/${id}`),
    retry: false,
  });
  const [initial, setInitial] = useState<InterviewSnapshot>();
  useEffect(() => {
    if (query.data && !initial) setInitial(query.data);
  }, [query.data, initial]);
  return initial && query.data ? (
    <InterviewPad
      key={initial.document.epoch}
      initial={initial}
      snapshot={query.data}
      onOpenQuestion={(next) => setInitial(next ?? query.data)}
    />
  ) : (
    <div className="match-page">
      <GlobalNav theme={theme.preference} onThemeChange={theme.setPreference} />
      <WorkspaceRecovery
        failed={query.isError}
        title={query.isError ? "Interview unavailable" : "Opening interview"}
        message={
          query.isError
            ? "Open your invitation or sign in to restore access."
            : "Connecting to the shared workspace…"
        }
        onRetry={() => query.refetch()}
        backHref="/interviews"
        backLabel="Back to interviews"
      />
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
  onOpenQuestion: (next?: InterviewSnapshot) => void;
}) {
  const id = snapshot.id;
  const theme = useTheme();
  const preferences = useLocalEditorPreferences();
  const queryClient = useQueryClient();
  const editor = useRef<PythonEditorHandle>(null);
  const [status, setStatus] = useState<CollaborationStatus>("connecting");
  const controller = useMemo(
    () =>
      createCollaboration(id, initial.document, setStatus, (next, result) => {
        queryClient.setQueryData(["interview", id], next);
        if (result)
          queryClient.setQueryData(
            ["interview-result", id, result.id, resultAccessFor(next)],
            result,
          );
      }),
    [id, initial.document.epoch],
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [languageSwitching, setLanguageSwitching] = useState(false);
  const [setup, setSetup] = useState(false);
  const [members, setMembers] = useState(false);
  const [tab, setTab] = useState<WorkspacePanel>("code");
  const [lifecycle, setLifecycle] = useState<"end" | "delete">();
  const [inviting, setInviting] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<number>();
  const [admitted, setAdmitted] = useState<{ id: string; previous?: string }>();
  const [admitting, setAdmitting] = useState(false);
  const changed = snapshot.document.epoch !== initial.document.epoch;
  useEffect(() => {
    if (
      changed &&
      !!snapshot.questionEpoch &&
      snapshot.questionEpoch === initial.questionEpoch &&
      controller.isSynchronized()
    )
      onOpenQuestion(snapshot);
  }, [changed, snapshot, initial.questionEpoch, controller, onOpenQuestion]);
  const interviewer = snapshot.role === "interviewer";
  const closed = snapshot.state === "closed";
  useErrorNotification(error);
  const sharedSubmission = snapshot.latestSubmissionId;
  const submissionId =
    sharedSubmission && sharedSubmission !== admitted?.previous ? sharedSubmission : admitted?.id;
  const resultAccess = resultAccessFor(snapshot);
  const result = useQuery({
    queryKey: ["interview-result", id, submissionId, resultAccess],
    queryFn: () => interviewRequest<Submission>(`/v1/interviews/${id}/submissions/${submissionId}`),
    enabled: !!submissionId,
  });
  const executing =
    busy || admitting || result.data?.state === "queued" || result.data?.state === "running";
  async function mutate(path: string, body: unknown = {}) {
    setBusy(true);
    setError(undefined);
    try {
      await interviewRequest(`/v1/interviews/${id}/${path}`, "POST", body, crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ["interview", id] });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Interview update failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function execute(kind: "run" | "submit") {
    if (executing || closed || changed || status !== "connected") return;
    setTab("results");
    setAdmitting(true);
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
      setAdmitted({ id: submission.id, previous: sharedSubmission });
      queryClient.setQueryData(["interview-result", id, submission.id, resultAccess], submission);
      await queryClient.invalidateQueries({ queryKey: ["interview", id] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not run code.");
    } finally {
      setAdmitting(false);
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
  async function changeLanguage(language: EditorLanguage) {
    if (disabled) return;
    setLanguageSwitching(true);
    setBusy(true);
    setError(undefined);
    try {
      if (!(await controller.flush())) throw new Error("Reconnect before changing language.");
      const next = await interviewRequest<InterviewSnapshot>(
        `/v1/interviews/${id}/language`,
        "POST",
        { language, epoch: initial.document.epoch },
        crypto.randomUUID(),
      );
      await queryClient.cancelQueries({ queryKey: ["interview", id] });
      queryClient.setQueryData(["interview", id], next);
      onOpenQuestion(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change language.");
    } finally {
      setLanguageSwitching(false);
      setBusy(false);
    }
  }
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(editor.current?.getSource() ?? initial.document.source);
    } catch {
      setError("Select and copy your code from the editor before opening the new question.");
    }
  }
  const question = changed ? initial.question : snapshot.question;
  const language = initial.question.language as EditorLanguage;
  const documentKey = `interview:${id}:${initial.document.epoch}`;
  const account = useSession();
  const host = snapshot.hostId === account.data?.user.id;
  const wasClosed = useRef(closed);
  useEffect(() => {
    if (closed && !wasClosed.current && host) setLifecycle("delete");
    wasClosed.current = closed;
  }, [closed, host]);
  async function applyLifecycle() {
    if (lifecycle === "end") {
      if (await mutate("close")) setLifecycle(host ? "delete" : undefined);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await interviewRequest(`/v1/interviews/${id}`, "DELETE");
      window.location.assign("/interviews");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete interview.");
    } finally {
      setBusy(false);
    }
  }
  const supportedIntelligence = language === "python" || language === "typescript";
  const intelligence = useIntelligence(
    (account.data?.user.id ?? `interview:${id}`) as DevelopmentIdentity,
    documentKey,
    supportedIntelligence && !closed,
    language,
    false,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const disabled = executing || closed || changed || status !== "connected";
  const hotkeys = {
    enabled: !settingsOpen && !setup && !members && !inviting && !lifecycle && !disabled,
    ignoreInputs: false,
    requireReset: true,
  };
  useHotkey(workspaceShortcuts.run.binding, () => void execute("run"), hotkeys);
  useHotkey(workspaceShortcuts.submit.binding, () => void execute("submit"), hotkeys);
  return (
    <WorkspaceLayout
      navigation={
        <GlobalNav
          theme={theme.preference}
          onThemeChange={theme.setPreference}
          workspaceSettings={{
            ...preferences,
            theme: theme.preference,
            onThemeChange: theme.setPreference,
            onOpenChange: setSettingsOpen,
          }}
        />
      }
      panel={tab}
      onPanelChange={setTab}
      header={
        <>
          <div className="interview-session-bar" aria-label="Interview session">
            <div className="interview-session-heading">
              <Tooltip content="Back to interviews">
                <a href="/interviews" aria-label="Back to interviews">
                  <ArrowLeft size={16} />
                </a>
              </Tooltip>
              <strong title={snapshot.title}>{snapshot.title}</strong>
            </div>
            {question.progress && (
              <OdysseyStepper
                progress={question.progress}
                selectedLevel={selectedLevel}
                onSelect={setSelectedLevel}
              />
            )}
            <div className="interview-session-actions">
              <InterviewParticipants
                snapshot={snapshot}
                open={members}
                onOpenChange={setMembers}
                busy={busy}
                onRole={(userId, role) => void mutate("members", { userId, role })}
                onRemove={(userId) => void mutate(`members/${encodeURIComponent(userId)}/remove`)}
              />
              {interviewer && !closed && (
                <Tooltip content="Change question">
                  <button
                    className="icon-button"
                    onClick={() => setSetup(true)}
                    aria-label="Change question"
                  >
                    <Icon name="problem" />
                  </button>
                </Tooltip>
              )}
              {snapshot.invites && !closed && (
                <InterviewInvitations
                  title={snapshot.title}
                  invites={snapshot.invites}
                  onOpenChange={setInviting}
                />
              )}
              {interviewer && !closed && (
                <Tooltip content="End interview">
                  <button
                    className="icon-button destructive-icon"
                    disabled={busy}
                    onClick={() => setLifecycle("end")}
                    aria-label="End interview"
                  >
                    <Icon name="flag" />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
          {(changed || status === "replaced") && (
            <div className="match-rule-notice" role="alert">
              <span>The question changed. Preserve your local code before continuing.</span>
              <button className="quiet-button" onClick={() => void copyCode()}>
                Copy my code
              </button>
              <button className="button button-secondary" onClick={() => onOpenQuestion()}>
                Open new question
              </button>
            </div>
          )}
          {closed && (
            <div className="match-rule-notice" role="status">
              <span>Interview ended. Code and results remain available.</span>
              {host && (
                <button
                  className="quiet-button button-destructive-hover"
                  onClick={() => setLifecycle("delete")}
                >
                  Delete interview
                </button>
              )}
            </div>
          )}
          {status === "offline" && (
            <div className="match-rule-notice" role="status">
              Connection interrupted. Keep this tab open; your edits retry automatically.
            </div>
          )}
        </>
      }
      problem={
        question.progress ? (
          <OdysseyPanel
            progress={question.progress}
            problem={question.problem}
            selectedLevel={selectedLevel}
          />
        ) : (
          <ProblemStatement problem={question.problem} />
        )
      }
      editor={
        <>
          <SolutionToolbar
            language={language}
            languages={(question.languages ?? Object.keys(languageFileNames)).map((language) => ({
              language,
            }))}
            disabled={disabled}
            onChange={(next) => void changeLanguage(next)}
            intelligence={
              supportedIntelligence
                ? {
                    status: intelligence.status,
                    hint:
                      intelligence.status === "ready"
                        ? "IntelliSense active"
                        : intelligence.status === "connecting"
                          ? "IntelliSense connecting"
                          : "IntelliSense unavailable",
                  }
                : undefined
            }
          />
          <div className="editor-frame">
            <PythonEditor
              ref={editor}
              documentKey={documentKey}
              documentUri={`file:///interviews/${id}/${languageFileNames[language]}`}
              initialSource={initial.document.source}
              language={language}
              theme={theme.theme}
              colorScheme={preferences.editorScheme}
              fontSize={preferences.fontSize}
              tabSize={preferences.tabSize}
              wrap={preferences.wrap}
              readOnly={closed || changed || languageSwitching}
              intelligenceExtensions={supportedIntelligence ? intelligence.extensions : undefined}
              collaborationExtension={controller.extension}
              onSourceChange={keepSource}
            />
          </div>
        </>
      }
      results={
        <>
          <InterviewTests
            question={question}
            interviewer={interviewer}
            submission={result.data}
            busy={admitting}
            managing={busy}
            closed={closed || changed}
            onReveal={(caseId, revealed) =>
              void mutate(`cases/${encodeURIComponent(caseId)}/visibility`, {
                revealed,
                questionEpoch: initial.questionEpoch,
              })
            }
          />
          {result.isError && (
            <p className="result-message" role="alert">
              Could not load results.{" "}
              <button className="quiet-button" onClick={() => void result.refetch()}>
                Retry
              </button>
            </p>
          )}
        </>
      }
      actions={
        <ExecutionActions
          disabled={disabled}
          onRun={() => void execute("run")}
          onSubmit={() => void execute("submit")}
        />
      }
    >
      <SessionDialog
        open={setup}
        onOpenChange={setSetup}
        title="Change question"
        description="This starts a new shared document. Copy code you want to keep first."
        pending={busy}
        className="match-creation-dialog"
      >
        <QuestionSetup
          showTitle={false}
          onSubmit={(question) => void replace(question)}
          busy={busy}
          label="Replace question and code"
        />
      </SessionDialog>
      <InterviewLifecycleDialog
        action={lifecycle}
        busy={busy}
        onClose={() => setLifecycle(undefined)}
        onConfirm={() => void applyLifecycle()}
      />
    </WorkspaceLayout>
  );
}
