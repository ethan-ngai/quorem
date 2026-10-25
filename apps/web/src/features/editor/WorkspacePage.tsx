/** @file WorkspacePage.tsx @description Coordinates problem loading and editor workspace panes. @module editor */
import { useErrorNotification } from "../../ui/Notifications";
import { useLocalEditorPreferences } from "../settings/useLocalEditorPreferences";
import { SessionDialog } from "../../ui/SessionDialog";
import { userFacingErrorMessage } from "../../ui/errors";
import { useHotkey } from "@tanstack/react-hotkeys";
import { workspaceShortcuts } from "./workspaceShortcuts";
import type {
  DevelopmentIdentity,
  MatchSnapshot,
  ProblemVersion,
  Workspace,
} from "@quorem/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useEffect, useRef, useState, type ReactNode } from "react";
import { GlobalNav } from "../navigation/GlobalNav";
import { MatchRuleNotice, useMatchRules } from "../matches/useMatchRules";
import {
  fetchProblem,
  fetchProblemVersion,
  fetchWorkspace,
  createWorkspace,
  switchMatchLanguage,
} from "./api";
import { HistoryDialog } from "./components/HistoryDialog";
import { EditorialPanel } from "./components/EditorialPanel";
import { ProblemStatement } from "./components/ProblemStatement";
import { customDraftStorageKey, readCustomDrafts, type CustomCaseDraft } from "./customCases";
import { LogoSpinner, LoadingScreen } from "../../ui/LoadingScreen";
import { CreateMatchDialog } from "../matches/CreateMatchDialog";
import { SaveIndicator, type SaveState } from "./components/SaveIndicator";
import { readPreference, writePreference } from "./editorSettings";
import {
  createBrowserDraftWriter,
  importBrowserDrafts,
  browserDraftScope,
  readBrowserDraft,
  writeBrowserDraft,
  clearOwnerRecovery,
  readLatestRecovery,
  writeRecovery,
} from "./recovery";
import { useTheme } from "./useTheme";
import { canExecuteDocument } from "./executionGuard";
import { OdysseyStepper } from "../odyssey/OdysseyStepper";
import { publicOdysseyPreview } from "../odyssey/publicPreview";
import { OdysseyPanel } from "../odyssey/OdysseyPanel";
import { interviewRequest } from "../interviews/api";
import type { OdysseyProgress } from "@quorem/contracts";
import { useSubmission } from "./useSubmission";
import { hostedIntelligenceEnabled } from "./intelligenceConfig";
import { useIntelligence } from "./useIntelligence";
import { PythonEditor, type PythonEditorHandle } from "./PythonEditor";
import { WorkspaceLayout } from "./components/WorkspaceLayout";
import { SolutionToolbar } from "./components/SolutionToolbar";
import { WorkspaceTests } from "./components/WorkspaceTests";
import { ExecutionActions } from "./components/ExecutionActions";
import "../../styles/workspace.css";

type Panel = "problem" | "code" | "results";

/** Returns a safe short message for load and save failures. */
function errorMessage(error: unknown) {
  return userFacingErrorMessage(error, "Something went wrong. Your code is still here.");
}

/** Opens one public problem in the resizable practice workspace. */
import { guestWorkspace } from "./guestWorkspace";
import { useSession } from "../auth/session";
import { languageFileNames, type EditorLanguage } from "./editorLanguages";

export function WorkspacePage({
  slug = "",
  match,
  matchWorkspaceId: providedMatchWorkspaceId,
  identity: providedIdentity,
  matchHeader,
}: {
  slug?: string;
  match?: MatchSnapshot;
  matchWorkspaceId?: string;
  identity?: DevelopmentIdentity;
  matchHeader?: ReactNode;
}) {
  const account = useSession();
  const identity = (account.data?.user.id ??
    providedIdentity ??
    "anonymous") as DevelopmentIdentity;
  const { preference: themePreference, setPreference: setThemePreference, theme } = useTheme();
  const [activePanel, setActivePanel] = useState<Panel>("code");
  const [createMatchOpen, setCreateMatchOpen] = useState(false);
  const [problem, setProblem] = useState<ProblemVersion>();
  const [workspace, setWorkspace] = useState<Workspace>();
  const [matchSelection, setMatchSelection] = useState<{ matchId: string; workspaceId: string }>();
  const matchWorkspaceId =
    matchSelection?.matchId === match?.id
      ? (matchSelection?.workspaceId ?? providedMatchWorkspaceId)
      : providedMatchWorkspaceId;
  const [languageSwitching, setLanguageSwitching] = useState(false);
  useEffect(() => {
    if (matchSelection && providedMatchWorkspaceId === matchSelection.workspaceId)
      setMatchSelection(undefined);
  }, [providedMatchWorkspaceId, matchSelection]);
  const [selectedLanguage, setSelectedLanguage] = useState<EditorLanguage>(() => {
    const saved = readPreference<string>(`quorem.language.v1.${slug}`, "python");
    return ["python", "java", "typescript", "ocaml"].includes(saved)
      ? (saved as EditorLanguage)
      : "python";
  });
  const [source, setSource] = useState("");
  const sourceRef = useRef(source);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customDrafts, setCustomDrafts] = useState<CustomCaseDraft[]>([]);
  const [signInPrompt, setSignInPrompt] = useState(false);
  const signInPromptOrigin = useRef<HTMLElement | null>(null);
  const [actionError, setActionError] = useState<string>();
  useErrorNotification(actionError);
  const [historyOpen, setHistoryOpen] = useState(false);
  const {
    editorScheme,
    onEditorSchemeChange: setEditorScheme,
    fontSize,
    onFontSizeChange: setFontSize,
    tabSize,
    onTabSizeChange: setTabSize,
    wrap,
    onWrapChange: setWrap,
  } = useLocalEditorPreferences();
  const editorRef = useRef<PythonEditorHandle>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const dirtyRef = useRef(false);
  const editGeneration = useRef(0);
  const saveNowRef = useRef<() => Promise<void>>(async () => {});
  const saveTimerRef = useRef<number | undefined>(undefined);
  const draftContextRef = useRef<
    | {
        key: string;
        identity: DevelopmentIdentity;
        workspaceId: string;
        problemVersionId: string;
        storageId: string;
      }
    | undefined
  >(undefined);
  const lastQueuedSourceRef = useRef<string | undefined>(undefined);
  const browserWriterRef = useRef<ReturnType<typeof createBrowserDraftWriter> | undefined>(
    undefined,
  );
  if (!browserWriterRef.current) {
    browserWriterRef.current = createBrowserDraftWriter((error, draft) => {
      const context = draftContextRef.current;
      if (
        context?.identity === draft.identity &&
        context.storageId === draft.workspaceId &&
        context.problemVersionId === draft.version
      ) {
        setSaveState("error");
        setActionError(errorMessage(error));
      }
    });
  }

  const problemQuery = useQuery({
    queryKey: ["problem", identity, match?.problemVersionId ?? slug],
    staleTime: 60_000,
    queryFn: () =>
      match ? fetchProblemVersion(identity, match.problemVersionId!) : fetchProblem(identity, slug),
    enabled: match ? !!match.problemVersionId && !!matchWorkspaceId : !!slug,
  });
  const workspaceQuery = useQuery({
    queryKey: ["workspace", identity, matchWorkspaceId ?? problemQuery.data?.id, selectedLanguage],
    queryFn: () =>
      match
        ? fetchWorkspace(identity, matchWorkspaceId!)
        : createWorkspace(identity, problemQuery.data!.id, selectedLanguage),
    enabled:
      !!account.data &&
      (account.data.kind !== "guest" || !!match) &&
      (match ? !!matchWorkspaceId : !!problemQuery.data),
    staleTime: 0,
    gcTime: 5 * 60_000,
  });

  const loadedWorkspace = useMemo(() => {
    if (account.data && (account.data.kind !== "guest" || match)) return workspaceQuery.data;
    if (!account.isPending && !match && problemQuery.data)
      return guestWorkspace(problemQuery.data, selectedLanguage);
    return undefined;
  }, [
    account.data,
    account.isPending,
    match,
    problemQuery.data,
    selectedLanguage,
    workspaceQuery.data,
  ]);

  useEffect(() => {
    if (!problemQuery.data || !loadedWorkspace) return;
    const nextContext = {
      key: `${identity}:${loadedWorkspace.id}:${problemQuery.data.id}`,
      identity,
      workspaceId: loadedWorkspace.id,
      problemVersionId: problemQuery.data.id,
      storageId: browserDraftScope(loadedWorkspace),
    };
    const previousContext = draftContextRef.current;
    if (previousContext?.key === nextContext.key) return;
    try {
      browserWriterRef.current?.flush();
    } catch (error) {
      setActionError(errorMessage(error));
    }
    if (previousContext && previousContext.key !== nextContext.key && dirtyRef.current) {
      const snapshot = sourceRef.current;
      void writeRecovery(
        previousContext.identity,
        previousContext.storageId,
        previousContext.problemVersionId,
        snapshot,
      ).catch(() => undefined);
    }
    window.clearTimeout(saveTimerRef.current);
    draftContextRef.current = nextContext;
    lastQueuedSourceRef.current = undefined;
    setProblem(problemQuery.data);
    setWorkspace(loadedWorkspace);
    setCustomMode(false);
    setCustomDrafts(
      problemQuery.data.odyssey ? [] : readCustomDrafts(nextContext.key, problemQuery.data),
    );
    const initialSource =
      readBrowserDraft(identity, nextContext.storageId, problemQuery.data.id) ??
      (account.data
        ? readBrowserDraft(
            "anonymous" as DevelopmentIdentity,
            nextContext.storageId,
            problemQuery.data.id,
          )
        : undefined) ??
      problemQuery.data.languages?.find((item) => item.language === loadedWorkspace.language)
        ?.starterSource ??
      problemQuery.data.starterSource;
    setSource(initialSource);
    sourceRef.current = initialSource;
    dirtyRef.current = false;
    setSaveState("saved");
  }, [problemQuery.data, loadedWorkspace, workspaceQuery.isFetching, identity, account.data]);

  useEffect(() => {
    if (!workspace || !problem || draftContextRef.current?.identity !== identity) return;
    let active = true;
    const context = draftContextRef.current;
    const generation = editGeneration.current;
    const load = async () => {
      // Preserve older recovery databases without importing server drafts.
      const snapshot =
        (await readLatestRecovery(identity, context.storageId, problem.id)) ??
        (await readLatestRecovery(identity, workspace.id, problem.id));
      if (
        active &&
        snapshot &&
        editGeneration.current === generation &&
        readBrowserDraft(identity, context.storageId, problem.id) === undefined
      ) {
        setSource(snapshot.source);
        editorRef.current?.replaceSource(snapshot.source);
        sourceRef.current = snapshot.source;
        writeBrowserDraft(identity, context.storageId, problem.id, snapshot.source);
      }
    };
    void load().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [workspace, problem, identity]);

  const updateSource = useCallback((next: string) => {
    editGeneration.current++;
    sourceRef.current = next;
    const wasDirty = dirtyRef.current;
    dirtyRef.current = true;
    if (!wasDirty) setSaveState("dirty");
    const context = draftContextRef.current;
    if (context)
      browserWriterRef.current?.schedule({
        identity: context.identity,
        workspaceId: context.storageId,
        version: context.problemVersionId,
        source: next,
      });
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void saveNowRef.current(), 750);
  }, []);

  const saveCurrentDraft = useCallback(async () => {
    const context = draftContextRef.current;
    if (
      !context ||
      !dirtyRef.current ||
      context.key !== `${identity}:${workspace?.id}:${problem?.id}`
    )
      return;
    const snapshot = sourceRef.current;
    if (snapshot === lastQueuedSourceRef.current) return;
    const key = context.key;
    setSaveState("saving");
    const task = saveQueue.current.then(() =>
      writeRecovery(context.identity, context.storageId, context.problemVersionId, snapshot),
    );
    lastQueuedSourceRef.current = snapshot;
    saveQueue.current = task.then(
      () => {},
      () => {},
    );
    try {
      browserWriterRef.current?.flush();
      await task;
      if (draftContextRef.current?.key !== key) return;
      if (sourceRef.current === snapshot) {
        dirtyRef.current = false;
        setSaveState("saved");
      } else {
        setSaveState("dirty");
      }
    } catch (error) {
      if (draftContextRef.current?.key !== key) return;
      if (lastQueuedSourceRef.current === snapshot) lastQueuedSourceRef.current = undefined;
      setSaveState("error");
      setActionError(errorMessage(error));
    }
  }, [identity, problem, workspace]);
  saveNowRef.current = saveCurrentDraft;

  useEffect(() => {
    const preserveDraft = () => {
      try {
        browserWriterRef.current?.flush();
      } catch (error) {
        setSaveState("error");
        setActionError(errorMessage(error));
      }
      const context = draftContextRef.current;
      if (context && dirtyRef.current)
        void writeRecovery(
          context.identity,
          context.storageId,
          context.problemVersionId,
          sourceRef.current,
        ).catch(() => undefined);
    };
    window.addEventListener("pagehide", preserveDraft);
    return () => {
      window.removeEventListener("pagehide", preserveDraft);
      window.clearTimeout(saveTimerRef.current);
      preserveDraft();
    };
  }, []);

  const dataMatchesRoute =
    (match ? problemQuery.data?.id === match.problemVersionId : problemQuery.data?.slug === slug) &&
    loadedWorkspace?.problemVersionId === problemQuery.data?.id;
  const dataMatchesState =
    problem?.id === problemQuery.data?.id && workspace?.id === loadedWorkspace?.id;
  const serverWorkspace = !!account.data && (account.data.kind !== "guest" || !!match);
  const loading =
    problemQuery.isPending ||
    account.isPending ||
    (serverWorkspace && workspaceQuery.isPending) ||
    !dataMatchesRoute ||
    !dataMatchesState ||
    !problem ||
    !workspace;
  const matchRules = useMatchRules(identity, match);
  const odyssey = useQuery({
    queryKey: ["odyssey", workspace?.id],
    queryFn: () => interviewRequest<OdysseyProgress>(`/v1/workspaces/${workspace!.id}/odyssey`),
    enabled: !!workspace && !!problem?.odyssey && serverWorkspace,
    refetchInterval: problem?.odyssey ? 2000 : false,
  });
  const displayedOdyssey =
    odyssey.data ?? (!serverWorkspace ? publicOdysseyPreview(problem) : undefined);
  const [selectedLevel, setSelectedLevel] = useState<number>();
  const runExamples = useMemo(
    () => odyssey.data?.levels.flatMap((level) => level.examples),
    [odyssey.data],
  );
  const execution = useSubmission({
    runExamples,
    level: odyssey.data?.level,
    identity,
    workspace,
    sourceRef,
    editorRef,
    customMode: problem?.odyssey ? false : customMode,
    drafts: customDrafts,
    problem,
    enabled:
      serverWorkspace &&
      (!problem?.odyssey || !!odyssey.data) &&
      !languageSwitching &&
      !matchRules.blocked &&
      canExecuteDocument({
        identity,
        contextKey: draftContextRef.current?.key,
        problem,
        workspace,
        slug,
        match,
        matchWorkspaceId,
        loaded: !loading,
      }),
  });
  const changeCustomDrafts = useCallback((drafts: CustomCaseDraft[]) => {
    setCustomDrafts(drafts);
    const context = draftContextRef.current;
    if (!context) return;
    try {
      localStorage.setItem(customDraftStorageKey(context.key), JSON.stringify(drafts));
    } catch {
      /* Custom inputs remain usable without browser storage. */
    }
  }, []);
  const submission = execution.submission;
  const submissionBusy = execution.busy;
  const admissionPending = execution.admissionPending;
  const changeLanguage = async (language: EditorLanguage) => {
    if (languageSwitching || submissionBusy || admissionPending) return;
    setLanguageSwitching(true);
    setActionError(undefined);
    try {
      await saveCurrentDraft();
      if (dirtyRef.current) throw new Error("Save the current draft before switching language.");
      if (match) {
        const selected = await switchMatchLanguage(identity, match.id, language);
        setMatchSelection({ matchId: match.id, workspaceId: selected.id });
      } else {
        writePreference(`quorem.language.v1.${slug}`, language);
        setSelectedLanguage(language);
      }
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setLanguageSwitching(false);
    }
  };
  const run = useCallback(async () => {
    if (!account.data || (account.data.kind === "guest" && !match)) {
      signInPromptOrigin.current = document.activeElement as HTMLElement | null;
      setSignInPrompt(true);
      return;
    }
    setActivePanel("results");
    await execution.run();
  }, [execution.run, account.data, match]);
  const submit = useCallback(async () => {
    if (!account.data || (account.data.kind === "guest" && !match)) {
      signInPromptOrigin.current = document.activeElement as HTMLElement | null;
      setSignInPrompt(true);
      return;
    }
    setActivePanel("results");
    if (await execution.submit()) setCustomMode(false);
  }, [execution.submit, account.data, match]);

  const hotkeyOptions = {
    enabled: !settingsOpen && !signInPrompt,
    ignoreInputs: false,
    requireReset: true,
  };
  useHotkey(workspaceShortcuts.run.binding, () => void run(), hotkeyOptions);
  useHotkey(workspaceShortcuts.submit.binding, () => void submit(), hotkeyOptions);
  useHotkey(workspaceShortcuts.save.binding, () => void saveNowRef.current(), hotkeyOptions);

  const restoreHistory = useCallback(
    async (historicalSource: string) => {
      if (!workspace) return;
      const context = draftContextRef.current;
      const generation = editGeneration.current;
      await saveCurrentDraft();
      await saveQueue.current;
      if (draftContextRef.current !== context) return;
      if (editGeneration.current !== generation) {
        dirtyRef.current = true;
        lastQueuedSourceRef.current = undefined;
        setSaveState("dirty");
        saveTimerRef.current = window.setTimeout(() => void saveNowRef.current(), 750);
        throw new Error(
          "Newer local edits were kept. Save to retain them instead of the restored history.",
        );
      }
      if (context)
        writeBrowserDraft(
          context.identity,
          context.storageId,
          context.problemVersionId,
          historicalSource,
        );
      editorRef.current?.replaceSource(historicalSource);
      sourceRef.current = historicalSource;
      const restoredGeneration = editGeneration.current;
      if (context)
        await writeRecovery(
          context.identity,
          context.storageId,
          context.problemVersionId,
          historicalSource,
        );
      if (editGeneration.current === restoredGeneration) {
        dirtyRef.current = false;
        window.clearTimeout(saveTimerRef.current);
        setSaveState("saved");
      }
    },
    [identity, workspace, saveCurrentDraft],
  );

  const loadError = problemQuery.error ?? workspaceQuery.error;
  const documentLanguage = (workspace?.language ?? selectedLanguage) as EditorLanguage;
  const virtualDocumentUri = `file:///workspace/${languageFileNames[documentLanguage]}`;
  const editorDocumentKey = workspace
    ? `${identity}:${workspace.id}:${workspace.problemVersionId}:${documentLanguage}`
    : "pending";
  const browserIntelligenceAvailable =
    documentLanguage === "python" || documentLanguage === "typescript";
  const intelligence = useIntelligence(
    identity,
    editorDocumentKey,
    !loading && browserIntelligenceAvailable,
    documentLanguage,
    account.data?.kind !== "guest" && account.data?.capabilities?.hostedIntelligence === true,
  );
  const intelligenceStatus = browserIntelligenceAvailable ? intelligence.status : "unavailable";
  const intelligenceHint = !browserIntelligenceAvailable
    ? "IntelliSense unavailable for this language."
    : {
        ready: "IntelliSense active",
        connecting: "IntelliSense connecting",
        paused: "IntelliSense paused. Follows the focused window automatically.",
        unavailable: "IntelliSense unavailable",
      }[intelligenceStatus];

  const actionsEnabled =
    !!account.data &&
    (!problem?.odyssey || !!odyssey.data) &&
    !languageSwitching &&
    !matchRules.blocked &&
    canExecuteDocument({
      identity,
      contextKey: draftContextRef.current?.key,
      problem,
      workspace,
      slug,
      match,
      matchWorkspaceId,
      loaded: !loading,
    });
  if (!problem || !workspace)
    return (
      <main className="workspace-loading" aria-live="polite">
        {loadError ? null : <LogoSpinner />}
        <h1>{loadError ? "Workspace unavailable" : "Opening workspace…"}</h1>
        {loadError && (
          <>
            <p>{errorMessage(loadError)}</p>
            <button
              className="button button-secondary"
              onClick={() => {
                void problemQuery.refetch();
                void workspaceQuery.refetch();
              }}
            >
              Retry
            </button>
          </>
        )}
      </main>
    );

  return (
    <>
      {loading && (
        <div className="workspace-loading workspace-transition" role="status">
          {loadError ? (
            <p role="alert">{errorMessage(loadError)}</p>
          ) : (
            <LoadingScreen label="Opening workspace…" />
          )}
          {loadError && (
            <button
              className="button button-secondary"
              onClick={() => {
                void problemQuery.refetch();
                void workspaceQuery.refetch();
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}
      <WorkspaceLayout
        pending={loading}
        navigation={
          <GlobalNav
            identity={identity}
            slug={match ? undefined : slug}
            mode={match?.mode}
            theme={themePreference}
            onThemeChange={setThemePreference}
            workspaceSettings={{
              onOpenChange: setSettingsOpen,
              onImportDrafts: async (file) => {
                try {
                  await saveCurrentDraft();
                  const imported = await importBrowserDrafts(await file.text(), identity);
                  if (imported > 0) window.location.reload();
                } catch (error) {
                  setActionError(errorMessage(error));
                }
              },
              theme: themePreference,
              onThemeChange: setThemePreference,
              editorScheme: editorScheme,
              onEditorSchemeChange: setEditorScheme,
              fontSize: fontSize,
              onFontSizeChange: setFontSize,
              tabSize: tabSize,
              onTabSizeChange: setTabSize,
              wrap: wrap,
              onWrapChange: setWrap,
              onHistory: () => setHistoryOpen(true),
              onClearRecovery: () => {
                void clearOwnerRecovery(identity);
              },
            }}
            onCreateMatch={() => {
              void saveCurrentDraft().then(() => setCreateMatchOpen(true));
            }}
          >
            <SaveIndicator state={saveState} onRetry={() => void saveCurrentDraft()} />
          </GlobalNav>
        }
        header={
          matchHeader ? (
            <>
              {matchHeader}
              <MatchRuleNotice message={matchRules.notice} onDismiss={matchRules.dismiss} />
            </>
          ) : odyssey.data ? (
            <OdysseyStepper
              progress={odyssey.data}
              selectedLevel={selectedLevel}
              onSelect={setSelectedLevel}
            />
          ) : undefined
        }
        panel={activePanel}
        onPanelChange={setActivePanel}
        problem={
          <>
            {problem.odyssey ? (
              displayedOdyssey ? (
                <OdysseyPanel
                  allowTopics={match?.rules.hints?.topics !== false}
                  progress={displayedOdyssey}
                  problem={problem}
                  selectedLevel={selectedLevel}
                >
                  <EditorialPanel
                    available={problem.complexityLanguages?.includes(documentLanguage) ?? false}
                    identity={identity}
                    versionId={problem.id}
                    language={documentLanguage}
                    inMatch={!!match && match.rules.hints?.complexity !== true}
                  />
                </OdysseyPanel>
              ) : (
                <p className="result-message" role="status">
                  {!account.data
                    ? "Sign in to start Odyssey."
                    : odyssey.isError
                      ? "Odyssey is unavailable for this account. Reload to retry."
                      : "Loading levels…"}
                </p>
              )
            ) : (
              <ProblemStatement
                problem={problem}
                allowTopics={match?.rules.hints?.topics !== false}
              >
                <EditorialPanel
                  available={problem.complexityLanguages?.includes(documentLanguage) ?? false}
                  key={`${identity}:${problem.id}`}
                  identity={identity}
                  versionId={problem.id}
                  language={documentLanguage}
                  inMatch={!!match && match.rules.hints?.complexity !== true}
                />
              </ProblemStatement>
            )}
          </>
        }
        editor={
          <>
            <SolutionToolbar
              language={documentLanguage}
              languages={problem.languages ?? [{ language: "python" }]}
              disabled={
                loading ||
                languageSwitching ||
                submissionBusy ||
                admissionPending ||
                (!!match && (match.state !== "active" || matchRules.blocked))
              }
              onChange={(value) => void changeLanguage(value)}
              intelligence={
                hostedIntelligenceEnabled || browserIntelligenceAvailable
                  ? { status: intelligenceStatus, hint: intelligenceHint }
                  : undefined
              }
            />
            <div className="editor-frame">
              <PythonEditor
                language={documentLanguage}
                key={editorDocumentKey}
                ref={editorRef}
                documentKey={editorDocumentKey}
                documentUri={virtualDocumentUri}
                initialSource={source}
                theme={theme}
                colorScheme={editorScheme}
                fontSize={fontSize}
                tabSize={tabSize}
                wrap={wrap}
                readOnly={languageSwitching}
                completionEnabled={true}
                intelligenceExtensions={
                  browserIntelligenceAvailable ? intelligence.extensions : undefined
                }
                onSourceChange={updateSource}
              />
            </div>
          </>
        }
        results={
          <WorkspaceTests
            problem={problem}
            progress={displayedOdyssey}
            submission={submission}
            busy={admissionPending || (execution.isPending && !!execution.submissionId)}
            error={execution.error}
            customMode={customMode}
            onCustomModeChange={setCustomMode}
            drafts={customDrafts}
            onDraftsChange={changeCustomDrafts}
            snapshot={execution.runSnapshot}
          />
        }
        actions={
          <ExecutionActions
            disabled={
              submissionBusy || (serverWorkspace ? !actionsEnabled : loading || languageSwitching)
            }
            onRun={() => void run()}
            onSubmit={() => void submit()}
            onCancel={
              submissionBusy &&
              !admissionPending &&
              !(submission?.kind === "submit" && workspace.kind === "match")
                ? () => void execution.cancel()
                : undefined
            }
          />
        }
      >
        <SessionDialog
          open={signInPrompt}
          onOpenChange={setSignInPrompt}
          title="Sign in to run tests"
          description="Sign in to run tests and submit solutions. You can keep editing without an account."
          returnFocus={() => signInPromptOrigin.current?.focus()}
        >
          <div className="competitive-dialog-actions">
            <button className="button button-secondary" onClick={() => setSignInPrompt(false)}>
              Keep editing
            </button>
            <a
              className="button button-primary"
              href={`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`}
            >
              Sign in
            </a>
          </div>
        </SessionDialog>
        {historyOpen && (
          <HistoryDialog
            identity={identity}
            workspace={workspace}
            onClose={() => setHistoryOpen(false)}
            onRestore={restoreHistory}
          />
        )}
        {createMatchOpen && (
          <CreateMatchDialog identity={identity} onClose={() => setCreateMatchOpen(false)} />
        )}
      </WorkspaceLayout>
    </>
  );
}
