/** @file WorkspacePage.tsx @description Coordinates problem loading and editor workspace panes. @module editor */
import { useHotkey } from "@tanstack/react-hotkeys";
import { workspaceShortcuts } from "./workspaceShortcuts";
import { ShortcutHint } from "./components/ShortcutKeys";
import { Tooltip } from "./components/Tooltip";
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
import { useSubmission } from "./useSubmission";
import { useIntelligence } from "./useIntelligence";
import { PythonEditor, type PythonEditorHandle } from "./PythonEditor";
import "../../styles/workspace.css";

type Panel = "problem" | "code" | "results";

const defaultPaneRatio = 40;
const defaultResultsHeight = 260;

/** Returns a safe short message for load and save failures. */
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Your code is still here.";
}

/** Opens one public problem in the resizable practice workspace. */
import { useSession } from "../auth/session";
import { languageLabels, languageFileNames, type EditorLanguage } from "./editorLanguages";

export function WorkspacePage({
  slug = "",
  match,
  matchWorkspaceId: providedMatchWorkspaceId,
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
  const [localIdentity, setLocalIdentity] = useState<DevelopmentIdentity>(() =>
    readPreference<DevelopmentIdentity>("quorem.dev-identity.v1", "alice"),
  );
  const fixtureIdentity = providedIdentity ?? localIdentity;
  const account = useSession(fixtureIdentity);
  const identity = (
    account.data?.mode === "managed" ? account.data.user.id : fixtureIdentity
  ) as DevelopmentIdentity;
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
  const [selectedLanguage, setSelectedLanguage] = useState<EditorLanguage>("python");
  const [source, setSource] = useState("");
  const sourceRef = useRef(source);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customDrafts, setCustomDrafts] = useState<CustomCaseDraft[]>([]);
  const [actionError, setActionError] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editorScheme, setEditorScheme] = useState(readEditorScheme);
  const [fontSize, setFontSize] = useState(() => readPreference("quorem.code-font-size.v1", 15));
  const [tabSize, setTabSize] = useState<2 | 4>(() =>
    readPreference<2 | 4>("quorem.tab-size.v1", 4),
  );
  const [wrap, setWrap] = useState(() => readPreference("quorem.wrap.v1", false));
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
    enabled: !!account.data && (match ? !!matchWorkspaceId : !!problemQuery.data),
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
      storageId: browserDraftScope(workspaceQuery.data),
    };
    const previousContext = draftContextRef.current;
    if (workspaceQuery.isFetching && previousContext?.key !== nextContext.key) return;
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
    setWorkspace(workspaceQuery.data);
    setCustomMode(false);
    setCustomDrafts(readCustomDrafts(nextContext.key, problemQuery.data));
    const initialSource =
      readBrowserDraft(identity, nextContext.storageId, problemQuery.data.id) ??
      problemQuery.data.languages?.find((item) => item.language === workspaceQuery.data.language)
        ?.starterSource ??
      problemQuery.data.starterSource;
    setSource(initialSource);
    sourceRef.current = initialSource;
    dirtyRef.current = false;
    setSaveState("saved");
  }, [problemQuery.data, workspaceQuery.data, workspaceQuery.isFetching, identity]);

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

  useEffect(() => {
    if (account.data?.mode === "development")
      writePreference("quorem.dev-identity.v1", fixtureIdentity);
  }, [fixtureIdentity, account.data?.mode]);

  useEffect(() => {
    writePreference("quorem.pane-ratio.v1", paneRatio);
  }, [paneRatio]);
  useEffect(() => writePreference("quorem.results-height.v1", resultsHeight), [resultsHeight]);
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
  const matchRules = useMatchRules(identity, match);
  const execution = useSubmission({
    identity,
    workspace,
    sourceRef,
    editorRef,
    customMode,
    drafts: customDrafts,
    problem,
    enabled:
      !!account.data &&
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
      } else setSelectedLanguage(language);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setLanguageSwitching(false);
    }
  };
  const run = useCallback(async () => {
    setActivePanel("results");
    await execution.run();
  }, [execution.run]);
  const submit = useCallback(async () => {
    setActivePanel("results");
    if (await execution.submit()) setCustomMode(false);
  }, [execution.submit]);

  const hotkeyOptions = {
    enabled: !settingsOpen,
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

  const activeIdentityChanged = useCallback(
    async (next: DevelopmentIdentity) => {
      if (account.data?.mode !== "development" || next === identity) return;
      await saveCurrentDraft();
      if (dirtyRef.current) return;
      writePreference("quorem.dev-identity.v1", next);
      setIdentity(next);
    },
    [identity, account.data?.mode, saveCurrentDraft, setIdentity],
  );

  const loadError = problemQuery.error ?? workspaceQuery.error;
  const workspaceStyle = {
    "--problem-ratio": `${paneRatio}%`,
    "--results-height": `${resultsHeight}px`,
  } as CSSProperties;
  const documentLanguage = (workspace?.language ?? selectedLanguage) as EditorLanguage;
  const virtualDocumentUri = `file:///workspace/${languageFileNames[documentLanguage]}`;
  const editorDocumentKey = workspace
    ? `${identity}:${workspace.id}:${workspace.problemVersionId}:${documentLanguage}`
    : "pending";
  const intelligence = useIntelligence(
    identity,
    editorDocumentKey,
    !loading && documentLanguage === "python",
  );

  const actionsEnabled =
    !!account.data &&
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
  if (!account.isPending && !account.data)
    return (
      <main className="workspace-loading">
        <Brand />
        <h1>Sign in to practice</h1>
        <a className="button button-primary" href="/login">
          Sign in
        </a>
      </main>
    );
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
        <GlobalNav
          identity={identity}
          slug={match ? undefined : slug}
          mode={match?.mode}
          onIdentityChange={(next) => void activeIdentityChanged(next)}
          theme={themePreference}
          onThemeChange={setThemePreference}
          preferences={
            <WorkspaceSettings
              onOpenChange={setSettingsOpen}
              onImportDrafts={async (file) => {
                try {
                  await saveCurrentDraft();
                  const imported = await importBrowserDrafts(await file.text(), identity);
                  if (imported > 0) window.location.reload();
                } catch (error) {
                  setActionError(errorMessage(error));
                }
              }}
              identity={identity}
              developmentIdentity={account.data?.mode === "development"}
              accountName={account.data?.user.displayName}
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
              onHistory={() => setHistoryOpen(true)}
              onClearRecovery={() => {
                void clearOwnerRecovery(identity);
              }}
            />
          }
          onCreateMatch={() => {
            void saveCurrentDraft().then(() => setCreateMatchOpen(true));
          }}
        >
          <SaveIndicator state={saveState} onRetry={() => void saveCurrentDraft()} />
        </GlobalNav>
        {matchHeader && (
          <div className="match-strip">
            {matchHeader}
            <MatchRuleNotice message={matchRules.notice} onDismiss={matchRules.dismiss} />
          </div>
        )}
        <nav className="mobile-tabs" aria-label="Workspace panes">
          {(["problem", "code", "results"] as const).map((panel) => (
            <button
              key={panel}
              aria-current={activePanel === panel ? "page" : undefined}
              onClick={() => setActivePanel(panel)}
            >
              <Icon
                name={panel === "problem" ? "problem" : panel === "code" ? "code" : "results"}
              />
              {panel === "problem" ? "Problem" : panel === "code" ? "Code" : "Results"}
            </button>
          ))}
        </nav>
        <div className="workspace-grid" data-active-panel={activePanel}>
          <section className="problem-pane" aria-label="Problem statement">
            <ProblemStatement problem={problem}>
              <EditorialPanel
                key={`${identity}:${problem.id}`}
                identity={identity}
                versionId={problem.id}
                language={documentLanguage}
                inMatch={!!match}
              />
            </ProblemStatement>
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
                <label className="editor-language">
                  <select
                    aria-label="Solution language"
                    value={documentLanguage}
                    disabled={
                      loading ||
                      languageSwitching ||
                      submissionBusy ||
                      admissionPending ||
                      (!!match && (match.state !== "active" || matchRules.blocked))
                    }
                    onChange={(event) => {
                      void changeLanguage(event.target.value as EditorLanguage);
                    }}
                  >
                    {(problem.languages ?? [{ language: "python" }]).map((item) => (
                      <option key={item.language} value={item.language}>
                        {languageLabels[item.language as EditorLanguage]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="code-options">
                  {documentLanguage === "python" && intelligence.status === "paused" && (
                    <Tooltip content="IntelliSense follows the focused window automatically.">
                      <span className="intelligence-status" role="status">
                        IntelliSense paused
                      </span>
                    </Tooltip>
                  )}
                  {documentLanguage === "python" && intelligence.status === "unavailable" && (
                    <span className="intelligence-status" role="status">
                      <span>IntelliSense unavailable</span>
                      <button className="quiet-button" onClick={intelligence.retry}>
                        Retry
                      </button>
                    </span>
                  )}
                </div>
              </div>
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
                  intelligenceExtensions={
                    documentLanguage === "python" ? intelligence.extensions : undefined
                  }
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
                        <Icon
                          name={
                            tab === "samples"
                              ? submission?.hiddenCases?.length
                                ? "lock"
                                : "samples"
                              : "custom"
                          }
                        />
                        {tab === "samples"
                          ? submission?.hiddenCases?.length
                            ? "Hidden cases"
                            : "Sample cases"
                          : "Custom cases"}
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
                    showCases={false}
                    customMode={customMode}
                    runWasCustom={execution.runSnapshot?.custom}
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
                      busy={admissionPending || (execution.isPending && !!execution.submissionId)}
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
              <Tooltip content={<ShortcutHint shortcut={workspaceShortcuts.run} />}>
                <button
                  className="button button-secondary"
                  disabled={submissionBusy || !actionsEnabled}
                  onClick={() => void run()}
                >
                  <Icon name="play" />
                  Run
                </button>
              </Tooltip>
              <Tooltip content={<ShortcutHint shortcut={workspaceShortcuts.submit} />}>
                <button
                  className="button button-primary"
                  disabled={submissionBusy || !actionsEnabled}
                  onClick={() => void submit()}
                >
                  <Icon name="submit" />
                  Submit
                </button>
              </Tooltip>
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
