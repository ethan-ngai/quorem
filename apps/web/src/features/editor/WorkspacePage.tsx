/** @file WorkspacePage.tsx @description Coordinates problem loading and editor workspace panes. @module editor */
import type {
  DevelopmentIdentity,
  MatchSnapshot,
  ProblemVersion,
  Workspace,
} from "@quorem/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  fetchProblem,
  fetchProblemVersion,
  fetchWorkspace,
  createWorkspace,
  restoreDraft,
  saveDraft,
} from "./api";
import { HistoryDialog } from "./components/HistoryDialog";
import { ProblemStatement } from "./components/ProblemStatement";
import { TestCases } from "./components/TestCases";
import { ResultContent } from "./components/ResultContent";
import { customDraftStorageKey, readCustomDrafts, type CustomCaseDraft } from "./customCases";
import { Brand, Icon } from "./components/Icon";
import { WorkspaceSettings } from "./components/WorkspaceSettings";
import { CreateMatchDialog } from "../matches/CreateMatchDialog";
import { SaveIndicator, type SaveState } from "./components/SaveIndicator";
import { ResizableDivider } from "./components/ResizableDivider";
import {
  readPreference,
  writePreference,
  readEditorScheme,
  editorSchemeStorageKey,
} from "./editorSettings";
import {
  clearOwnerRecovery,
  readLatestRecovery,
  writeRecovery,
  type RecoverySnapshot,
} from "./recovery";
import { useTheme } from "./useTheme";
import { canExecuteDocument } from "./executionGuard";
import { useSubmission } from "./useSubmission";
import { useIntelligence } from "./useIntelligence";
import { PythonEditor, type PythonEditorHandle } from "./PythonEditor";
import "../../styles/workspace.css";

type Panel = "problem" | "code" | "results";

const problemSlugs = [
  "run-widths",
  "mirror-letters",
  "segment-sums",
  "level-spreads",
  "split-load",
  "quota-window",
];

const defaultPaneRatio = 40;
const defaultResultsHeight = 260;

/** Returns a safe short message for load and save failures. */
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Your code is still here.";
}

/** Opens one public problem in the resizable practice workspace. */
export function WorkspacePage({
  slug = "",
  match,
  matchWorkspaceId,
  identity: providedIdentity,
  onIdentityChange,
  matchHeader,
}: {
  slug?: string;
  match?: MatchSnapshot;
  matchWorkspaceId?: string;
  identity?: DevelopmentIdentity;
  onIdentityChange?: (identity: DevelopmentIdentity) => void;
  matchHeader?: ReactNode;
}) {
  const navigate = useNavigate();
  const [localIdentity, setLocalIdentity] = useState<DevelopmentIdentity>(() =>
    readPreference<DevelopmentIdentity>("quorem.dev-identity.v1", "alice"),
  );
  const identity = providedIdentity ?? localIdentity;
  const setIdentity = onIdentityChange ?? setLocalIdentity;
  const { preference: themePreference, setPreference: setThemePreference, theme } = useTheme();
  const [paneRatio, setPaneRatio] = useState(() =>
    readPreference("quorem.pane-ratio.v1", defaultPaneRatio),
  );
  const [resultsHeight, setResultsHeight] = useState(() =>
    readPreference("quorem.results-height.v1", defaultResultsHeight),
  );
  const [activePanel, setActivePanel] = useState<Panel>("code");
  const [createMatchOpen, setCreateMatchOpen] = useState(false);
  const [problem, setProblem] = useState<ProblemVersion>();
  const [workspace, setWorkspace] = useState<Workspace>();
  const [source, setSource] = useState("");
  const sourceRef = useRef(source);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [localRecovery, setLocalRecovery] = useState<RecoverySnapshot>();
  const [customMode, setCustomMode] = useState(false);
  const [customDrafts, setCustomDrafts] = useState<CustomCaseDraft[]>([]);
  const [actionError, setActionError] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shortcutsEnabled, setShortcutsEnabled] = useState(() =>
    readPreference("quorem.shortcuts.v1", true),
  );
  const [editorScheme, setEditorScheme] = useState(readEditorScheme);
  const [fontSize, setFontSize] = useState(() => readPreference("quorem.code-font-size.v1", 15));
  const [tabSize, setTabSize] = useState<2 | 4>(() =>
    readPreference<2 | 4>("quorem.tab-size.v1", 4),
  );
  const [wrap, setWrap] = useState(() => readPreference("quorem.wrap.v1", false));
  const editorRef = useRef<PythonEditorHandle>(null);
  const saveSequence = useRef(0);
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
        editorSessionId: string;
      }
    | undefined
  >(undefined);
  const lastQueuedSourceRef = useRef<string | undefined>(undefined);

  const problemQuery = useQuery({
    queryKey: ["problem", identity, match?.problemVersionId ?? slug],
    queryFn: () =>
      match ? fetchProblemVersion(identity, match.problemVersionId!) : fetchProblem(identity, slug),
    enabled: match ? !!match.problemVersionId && !!matchWorkspaceId : !!slug,
  });
  const workspaceQuery = useQuery({
    queryKey: ["workspace", identity, matchWorkspaceId ?? problemQuery.data?.id],
    queryFn: () =>
      match
        ? fetchWorkspace(identity, matchWorkspaceId!)
        : createWorkspace(identity, problemQuery.data!.id),
    enabled: match ? !!matchWorkspaceId : !!problemQuery.data,
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (!problemQuery.data || !workspaceQuery.data) return;
    const nextContext = {
      key: `${identity}:${workspaceQuery.data.id}:${problemQuery.data.id}`,
      identity,
      workspaceId: workspaceQuery.data.id,
      problemVersionId: problemQuery.data.id,
      editorSessionId: crypto.randomUUID(),
    };
    const previousContext = draftContextRef.current;
    if (workspaceQuery.isFetching && previousContext?.key !== nextContext.key) return;
    if (previousContext?.key === nextContext.key) return;
    if (previousContext && previousContext.key !== nextContext.key && dirtyRef.current) {
      const snapshot = sourceRef.current;
      void writeRecovery(
        previousContext.identity,
        previousContext.workspaceId,
        previousContext.problemVersionId,
        snapshot,
      ).catch(() => undefined);
      if (snapshot !== lastQueuedSourceRef.current) {
        const sequence = String(++saveSequence.current);
        const pendingSave = saveQueue.current.then(() =>
          saveDraft(previousContext.identity, previousContext.workspaceId, {
            source: snapshot,
            editorSessionId: previousContext.editorSessionId,
            saveSequence: sequence,
          }),
        );
        saveQueue.current = pendingSave.then(
          () => {},
          () => {},
        );
      }
    }
    window.clearTimeout(saveTimerRef.current);
    draftContextRef.current = nextContext;
    saveSequence.current = 0;
    lastQueuedSourceRef.current = undefined;
    setProblem(problemQuery.data);
    setWorkspace(workspaceQuery.data);
    setCustomMode(false);
    setCustomDrafts(readCustomDrafts(nextContext.key, problemQuery.data));
    const initialSource = workspaceQuery.data.draft.source;
    setSource(initialSource);
    sourceRef.current = initialSource;
    dirtyRef.current = false;
    setSaveState("saved");
    setLocalRecovery(undefined);
  }, [problemQuery.data, workspaceQuery.data, workspaceQuery.isFetching, identity]);

  useEffect(() => {
    if (!workspace || !problem || draftContextRef.current?.identity !== identity) return;
    let active = true;
    void readLatestRecovery(identity, workspace.id, problem.id)
      .then((snapshot) => {
        if (active && snapshot && snapshot.source !== sourceRef.current) setLocalRecovery(snapshot);
      })
      .catch(() => {
        if (active) setLocalRecovery(undefined);
      });
    return () => {
      active = false;
    };
  }, [workspace, problem, identity]);

  useEffect(() => {
    writePreference("quorem.dev-identity.v1", identity);
  }, [identity]);

  useEffect(() => {
    writePreference("quorem.pane-ratio.v1", paneRatio);
  }, [paneRatio]);
  useEffect(() => writePreference("quorem.results-height.v1", resultsHeight), [resultsHeight]);
  useEffect(() => writePreference("quorem.shortcuts.v1", shortcutsEnabled), [shortcutsEnabled]);
  useEffect(() => writePreference("quorem.code-font-size.v1", fontSize), [fontSize]);
  useEffect(() => writePreference(editorSchemeStorageKey, editorScheme), [editorScheme]);
  useEffect(() => writePreference("quorem.tab-size.v1", tabSize), [tabSize]);
  useEffect(() => writePreference("quorem.wrap.v1", wrap), [wrap]);

  const updateSource = useCallback((next: string) => {
    editGeneration.current++;
    sourceRef.current = next;
    const wasDirty = dirtyRef.current;
    dirtyRef.current = true;
    if (!wasDirty) setSaveState("dirty");
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
    const sequence = String(++saveSequence.current);
    const sessionId = context.editorSessionId;
    const key = context.key;
    setSaveState("saving");
    const recoveryWrite = writeRecovery(
      context.identity,
      context.workspaceId,
      context.problemVersionId,
      snapshot,
    ).catch(() => undefined);
    const task = saveQueue.current.then(() =>
      saveDraft(context.identity, context.workspaceId, {
        source: snapshot,
        editorSessionId: sessionId,
        saveSequence: sequence,
      }),
    );
    lastQueuedSourceRef.current = snapshot;
    saveQueue.current = task.then(
      () => {},
      () => {},
    );
    try {
      await task;
      await recoveryWrite;
      if (draftContextRef.current?.key !== key) return;
      if (sourceRef.current === snapshot) {
        dirtyRef.current = false;
        setSaveState("saved");
        setLocalRecovery(undefined);
      } else {
        setSaveState("dirty");
      }
    } catch (error) {
      await recoveryWrite;
      if (draftContextRef.current?.key !== key) return;
      if (lastQueuedSourceRef.current === snapshot) lastQueuedSourceRef.current = undefined;
      setSaveState(navigator.onLine ? "error" : "offline");
      setActionError(errorMessage(error));
    }
  }, [identity, problem, workspace]);
  saveNowRef.current = saveCurrentDraft;

  useEffect(() => {
    const preserveDraft = () => {
      const context = draftContextRef.current;
      if (context && dirtyRef.current)
        void writeRecovery(
          context.identity,
          context.workspaceId,
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
    workspaceQuery.data?.problemVersionId === problemQuery.data?.id;
  const dataMatchesState =
    problem?.id === problemQuery.data?.id && workspace?.id === workspaceQuery.data?.id;
  const loading =
    problemQuery.isPending ||
    workspaceQuery.isPending ||
    !dataMatchesRoute ||
    !dataMatchesState ||
    !problem ||
    !workspace;
  const execution = useSubmission({
    identity,
    workspace,
    sourceRef,
    editorRef,
    customMode,
    drafts: customDrafts,
    problem,
    enabled: canExecuteDocument({
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
  const run = useCallback(async () => {
    setActivePanel("results");
    await execution.run();
  }, [execution.run]);
  const submit = useCallback(async () => {
    setActivePanel("results");
    await execution.submit();
  }, [execution.submit]);

  useEffect(() => {
    if (!shortcutsEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void saveNowRef.current();
      } else if (key === "enter" && event.shiftKey) {
        event.preventDefault();
        void submit();
      } else if (key === "enter") {
        event.preventDefault();
        void run();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcutsEnabled, run, submit]);

  const recoverLocal = useCallback(async () => {
    if (
      !localRecovery ||
      !workspace ||
      !problem ||
      localRecovery.scope !== `${identity}:${workspace.id}:${problem.id}:python`
    )
      return;
    editorRef.current?.replaceSource(localRecovery.source);
    sourceRef.current = localRecovery.source;
    dirtyRef.current = true;
    setSaveState("dirty");
    setLocalRecovery(undefined);
  }, [localRecovery, identity, workspace, problem]);

  const restoreHistory = useCallback(
    async (historicalSource: string, revision: string) => {
      if (!workspace) return;
      const context = draftContextRef.current;
      const generation = editGeneration.current;
      await saveCurrentDraft();
      await saveQueue.current;
      await restoreDraft(identity, workspace.id, revision);
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
      editorRef.current?.replaceSource(historicalSource);
      sourceRef.current = historicalSource;
      if (context)
        void writeRecovery(
          context.identity,
          context.workspaceId,
          context.problemVersionId,
          historicalSource,
        ).catch(() => undefined);
      dirtyRef.current = false;
      window.clearTimeout(saveTimerRef.current);
      setLocalRecovery(undefined);
      setSaveState("saved");
    },
    [identity, workspace, saveCurrentDraft],
  );

  const activeIdentityChanged = useCallback(
    async (next: DevelopmentIdentity) => {
      if (next === identity) return;
      if (
        dirtyRef.current &&
        !window.confirm("There are unsaved changes in this workspace. Switch local user anyway?")
      )
        return;
      await saveCurrentDraft();
      setIdentity(next);
    },
    [identity, saveCurrentDraft, setIdentity],
  );

  const loadError = problemQuery.error ?? workspaceQuery.error;
  const workspaceStyle = {
    "--problem-ratio": `${paneRatio}%`,
    "--results-height": `${resultsHeight}px`,
  } as CSSProperties;
  const virtualDocumentUri = "file:///workspace/main.py";
  const editorDocumentKey = workspace
    ? `${identity}:${workspace.id}:${workspace.problemVersionId}:python`
    : "pending";
  const intelligence = useIntelligence(identity, editorDocumentKey, !loading);

  const actionsEnabled = canExecuteDocument({
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
        <Brand />
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
          <p>{loadError ? errorMessage(loadError) : "Opening workspace…"}</p>
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
      <main
        className={`app-shell ${match ? "has-match" : ""}`}
        aria-busy={loading}
        style={{ ...workspaceStyle, visibility: loading ? "hidden" : undefined }}
        inert={loading}
      >
        <header className="topbar">
          <Brand />
          <nav className="workspace-nav" aria-label="Workspace navigation">
            {match ? (
              <a className="quiet-button" href="/run-widths">
                Practice
              </a>
            ) : (
              <details className="problem-picker">
                <summary>
                  Problems
                  <Icon name="chevron" />
                </summary>
                <div className="problem-menu">
                  {problemSlugs.map((item) => (
                    <button
                      key={item}
                      aria-current={item === slug ? "page" : undefined}
                      onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        void navigate({ to: "/$slug", params: { slug: item } });
                      }}
                    >
                      {item.replaceAll("-", " ")}
                      {item === slug && <Icon name="submit" />}
                    </button>
                  ))}
                </div>
              </details>
            )}
            <button
              className="quiet-button private-match-button"
              title="Private match"
              aria-label="Create private match"
              onClick={async () => {
                await saveCurrentDraft();
                setCreateMatchOpen(true);
              }}
            >
              <Icon name="people" />
              <span>Private match</span>
            </button>
          </nav>
          <div className="topbar-spacer" />
          <SaveIndicator state={saveState} onRetry={() => void saveCurrentDraft()} />

          <WorkspaceSettings
            identity={identity}
            onIdentityChange={(next) => void activeIdentityChanged(next)}
            theme={themePreference}
            onThemeChange={setThemePreference}
            editorScheme={editorScheme}
            onEditorSchemeChange={setEditorScheme}
            fontSize={fontSize}
            onFontSizeChange={setFontSize}
            tabSize={tabSize}
            onTabSizeChange={setTabSize}
            wrap={wrap}
            onWrapChange={setWrap}
            shortcuts={shortcutsEnabled}
            onShortcutsChange={setShortcutsEnabled}
            onHistory={() => setHistoryOpen(true)}
            onClearRecovery={() => {
              void clearOwnerRecovery(identity);
              setLocalRecovery(undefined);
            }}
          />
        </header>
        {matchHeader && <div className="match-strip">{matchHeader}</div>}
        <nav className="mobile-tabs" aria-label="Workspace panes">
          {(["problem", "code", "results"] as const).map((panel) => (
            <button
              key={panel}
              aria-current={activePanel === panel ? "page" : undefined}
              onClick={() => setActivePanel(panel)}
            >
              {panel === "problem" ? "Problem" : panel === "code" ? "Code" : "Results"}
            </button>
          ))}
        </nav>
        <div className="workspace-grid" data-active-panel={activePanel}>
          <section className="problem-pane" aria-label="Problem statement">
            <ProblemStatement problem={problem} />
          </section>
          <ResizableDivider
            axis="x"
            value={paneRatio}
            minimum={25}
            maximum={60}
            onChange={setPaneRatio}
          />
          <div className="solution-pane">
            <section className="coding-pane" aria-label="Code editor">
              <div className="code-toolbar">
                <span className="editor-language">Python</span>
                <div className="code-options">
                  {(intelligence.status === "unavailable" ||
                    intelligence.status === "replaced") && (
                    <span className="intelligence-status" role="status">
                      <span>
                        {intelligence.status === "replaced"
                          ? "Active in another tab"
                          : "IntelliSense unavailable"}
                      </span>
                      <button className="quiet-button" onClick={intelligence.retry}>
                        {intelligence.status === "replaced" ? "Use here" : "Retry"}
                      </button>
                    </span>
                  )}
                </div>
              </div>
              {localRecovery && (
                <div className="recovery-banner" role="status">
                  <span>Recover draft · {new Date(localRecovery.savedAt).toLocaleString()}</span>
                  <button onClick={() => void recoverLocal()}>Restore</button>
                  <button
                    className="icon-button"
                    aria-label="Dismiss local recovery"
                    onClick={() => {
                      setLocalRecovery(undefined);
                      void writeRecovery(
                        identity,
                        workspace.id,
                        problem.id,
                        sourceRef.current,
                      ).catch(() => undefined);
                    }}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              )}
              <div className="editor-frame">
                <PythonEditor
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
                  intelligenceExtensions={intelligence.extensions}
                  onSourceChange={updateSource}
                />
              </div>
            </section>
            <ResizableDivider
              axis="y"
              value={resultsHeight}
              minimum={170}
              maximum={480}
              onChange={setResultsHeight}
            />
            <section className="results-pane" aria-label="Execution results">
              <div className="results-toolbar">
                <div className="result-tabs" role="tablist" aria-label="Tests">
                  {(["samples", "custom"] as const).map((tab) => {
                    const selected = customMode === (tab === "custom");
                    return (
                      <button
                        key={tab}
                        id={`tests-${tab}-tab`}
                        role="tab"
                        aria-selected={selected}
                        aria-controls={`tests-${tab}-panel`}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => setCustomMode(tab === "custom")}
                        onKeyDown={(event) => {
                          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                            event.preventDefault();
                            const next =
                              event.key === "Home"
                                ? "samples"
                                : event.key === "End"
                                  ? "custom"
                                  : tab === "samples"
                                    ? "custom"
                                    : "samples";
                            setCustomMode(next === "custom");
                            document.getElementById(`tests-${next}-tab`)?.focus();
                          }
                        }}
                      >
                        {tab === "samples" ? "Sample cases" : "Custom cases"}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="results-content case-results-content">
                <div aria-live="polite" className="case-result-summary">
                  <ResultContent
                    submission={submission}
                    busy={admissionPending || (execution.isPending && !!execution.submissionId)}
                    error={execution.error}
                    showCases={!execution.runSnapshot}
                  />
                </div>
                {(["samples", "custom"] as const).map((tab) => (
                  <div
                    key={tab}
                    id={`tests-${tab}-panel`}
                    role="tabpanel"
                    aria-labelledby={`tests-${tab}-tab`}
                    hidden={customMode !== (tab === "custom")}
                  >
                    <TestCases
                      key={`${identity}:${workspace.id}:${problem.id}:${tab}`}
                      problem={problem}
                      customMode={tab === "custom"}
                      drafts={customDrafts}
                      onDraftsChange={changeCustomDrafts}
                      submission={submission}
                      snapshot={execution.runSnapshot}
                    />
                  </div>
                ))}
              </div>
              {actionError && (
                <p className="action-error" role="alert">
                  {actionError}
                </p>
              )}
            </section>
          </div>
          <footer className="execution-bar" aria-label="Execution actions">
            <div className="run-actions">
              {submissionBusy &&
                !admissionPending &&
                !(submission?.kind === "submit" && workspace.kind === "match") && (
                  <button className="quiet-button" onClick={() => void execution.cancel()}>
                    Cancel run
                  </button>
                )}
              <button
                className="button button-secondary"
                disabled={submissionBusy || !actionsEnabled}
                onClick={() => void run()}
                title="Run (Ctrl/Cmd+Enter)"
              >
                <Icon name="play" />
                Run
              </button>
              <button
                className="button button-primary"
                disabled={submissionBusy || !actionsEnabled}
                onClick={() => void submit()}
                title="Submit (Ctrl/Cmd+Shift+Enter)"
              >
                <Icon name="submit" />
                Submit
              </button>
            </div>
          </footer>
        </div>
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
      </main>
    </>
  );
}
