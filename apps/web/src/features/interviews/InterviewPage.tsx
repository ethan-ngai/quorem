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
import { WorkspaceTests } from "../editor/components/WorkspaceTests";
import { ExecutionActions } from "../editor/components/ExecutionActions";
import { TestCases } from "../editor/components/TestCases";
import type { CustomCaseDraft } from "../editor/customCases";
import { Icon } from "../editor/components/Icon";
import { Tooltip } from "../editor/components/Tooltip";
import { SelectField } from "../../ui/SelectField";
import { SessionDialog } from "../../ui/SessionDialog";
import { SessionBar } from "../../ui/SessionBar";
import { WorkspaceRecovery } from "../../ui/WorkspaceRecovery";
import { InvitationActions } from "../matches/InvitationActions";
import { shareInvitation } from "../matches/shareInvitation";
import "../../styles/workspace.css";
const noDrafts: CustomCaseDraft[] = [];
const keepDrafts = () => {};
const keepSource = () => {};
import "./collaboration.css";

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
  return initial && query.data ? (
    <InterviewPad
      key={initial.document.epoch}
      initial={initial}
      snapshot={query.data}
      onOpenQuestion={() => setInitial(query.data)}
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
  const [tab, setTab] = useState<WorkspacePanel>("code");
  const [ending, setEnding] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [admitted, setAdmitted] = useState<{ id: string; previous?: string }>();
  const [admitting, setAdmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const changed = snapshot.document.epoch !== initial.document.epoch;
  const interviewer = snapshot.role === "interviewer";
  const closed = snapshot.state === "closed";
  useErrorNotification(error);
  const sharedSubmission = snapshot.latestSubmissionId;
  const submissionId =
    sharedSubmission && sharedSubmission !== admitted?.previous ? sharedSubmission : admitted?.id;
  const result = useQuery({
    queryKey: ["interview-result", id, submissionId],
    queryFn: () => interviewRequest<Submission>(`/v1/interviews/${id}/submissions/${submissionId}`),
    enabled: !!submissionId,
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.state ?? "") ? 600 : false,
  });
  const executing =
    busy || admitting || result.data?.state === "queued" || result.data?.state === "running";
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
      queryClient.setQueryData(["interview-result", id, submission.id], submission);
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
  async function copyInvitation() {
    try {
      await navigator.clipboard.writeText(
        new URL(snapshot.invitePath!, window.location.origin).href,
      );
      setCopied(true);
    } catch {
      setError("Could not copy invitation.");
    }
  }
  async function shareInvite() {
    setSharing(true);
    try {
      if (
        (await shareInvitation(new URL(snapshot.invitePath!, window.location.origin).href)) ===
        "copied"
      )
        setCopied(true);
    } catch {
      setError("Could not share invitation.");
    } finally {
      setSharing(false);
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
    enabled: !settingsOpen && !setup && !members && !disabled,
    ignoreInputs: false,
    requireReset: true,
  };
  useHotkey(workspaceShortcuts.run.binding, () => void execute("run"), hotkeys);
  useHotkey(workspaceShortcuts.submit.binding, () => void execute("submit"), hotkeys);
  const privateTests =
    interviewer && !!question.privateCases?.length ? (
      <details className="problem-section">
        <summary className="quiet-button">
          Interviewer-private tests ({question.privateCases.length})
        </summary>
        <div className="authoring-case-browser">
          <TestCases
            problem={{ ...question.problem, examples: question.privateCases }}
            customMode={false}
            drafts={noDrafts}
            onDraftsChange={keepDrafts}
          />
        </div>
      </details>
    ) : undefined;
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
          <SessionBar
            label="Interview session"
            actions={
              <>
                <Tooltip content="Participants">
                  <button
                    className="icon-button"
                    onClick={() => setMembers(true)}
                    aria-label={`Participants (${snapshot.members.length})`}
                  >
                    <Icon name="people" />
                  </button>
                </Tooltip>
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
                {snapshot.invitePath && !closed && (
                  <InvitationActions
                    copied={copied}
                    sharing={sharing}
                    onCopy={() => void copyInvitation()}
                    onShare={() => void shareInvite()}
                  />
                )}
                {interviewer && !closed && (
                  <Tooltip content="End interview">
                    <button
                      className="icon-button destructive-icon"
                      disabled={busy}
                      onClick={() => setEnding(true)}
                      aria-label="End interview"
                    >
                      <Icon name="flag" />
                    </button>
                  </Tooltip>
                )}
              </>
            }
          >
            <div className="competitive-player-score">
              <a href="/interviews" className="text-link">
                Interviews
              </a>
              <strong>{snapshot.title}</strong>
              <span className="score-judging">{interviewer ? "Interviewer" : "Interviewee"}</span>
            </div>
          </SessionBar>
          {(changed || status === "replaced") && (
            <div className="match-rule-notice" role="alert">
              <span>The question changed. Preserve your local code before continuing.</span>
              <button className="quiet-button" onClick={() => void copyCode()}>
                Copy my code
              </button>
              <button className="button button-secondary" onClick={onOpenQuestion}>
                Open new question
              </button>
            </div>
          )}
          {closed && (
            <div className="match-rule-notice" role="status">
              Interview ended. Code and results remain available.
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
          <OdysseyPanel progress={question.progress} problem={question.problem}>
            {privateTests}
          </OdysseyPanel>
        ) : (
          <ProblemStatement problem={question.problem}>{privateTests}</ProblemStatement>
        )
      }
      editor={
        <>
          <SolutionToolbar
            language={language}
            languages={[{ language }]}
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
              readOnly={closed || changed}
              intelligenceExtensions={supportedIntelligence ? intelligence.extensions : undefined}
              collaborationExtension={controller.extension}
              onSourceChange={keepSource}
            />
          </div>
        </>
      }
      results={
        <>
          <WorkspaceTests
            progress={question.progress}
            problem={question.problem}
            submission={result.data}
            busy={admitting}
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
        open={members}
        onOpenChange={setMembers}
        title="Participants"
        description="Everyone shares the code and execution results."
        pending={busy}
        className="match-creation-dialog"
      >
        <div className="competitive-seats">
          {snapshot.members.map((member) => (
            <div className="competitive-seat" key={member.userId}>
              <Icon name="people" />
              <div>
                <strong>{member.name}</strong>
                <span>
                  {member.guest ? "Guest · " : ""}
                  {member.role === "interviewer" ? "Interviewer" : "Interviewee"}
                </span>
              </div>
              {interviewer && !closed && member.userId !== snapshot.hostId && (
                <>
                  <SelectField
                    label={`Role for ${member.name}`}
                    value={member.role}
                    disabled={busy}
                    onChange={(role) =>
                      void mutate("members", { userId: member.userId, role: role as InterviewRole })
                    }
                    options={[
                      { value: "interviewer", label: "Interviewer" },
                      { value: "interviewee", label: "Interviewee" },
                    ]}
                  />
                  <Tooltip content="Remove participant">
                    <button
                      className="icon-button destructive-icon"
                      disabled={busy}
                      aria-label={`Remove ${member.name}`}
                      onClick={() =>
                        void mutate(`members/${encodeURIComponent(member.userId)}/remove`)
                      }
                    >
                      <Icon name="close" />
                    </button>
                  </Tooltip>
                </>
              )}
            </div>
          ))}
        </div>
      </SessionDialog>
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
      <SessionDialog
        open={ending}
        onOpenChange={setEnding}
        title="End interview?"
        description="Editing and execution will stop. Code and results remain available."
        pending={busy}
      >
        <footer className="competitive-dialog-actions">
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => setEnding(false)}
          >
            Keep interviewing
          </button>
          <button
            className="button button-primary"
            disabled={busy}
            onClick={() => void mutate("close").then(() => setEnding(false))}
          >
            End interview
          </button>
        </footer>
      </SessionDialog>
    </WorkspaceLayout>
  );
}
