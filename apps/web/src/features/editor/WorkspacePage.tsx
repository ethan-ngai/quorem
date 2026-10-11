/** @file WorkspacePage.tsx @description Coordinates problem loading and editor workspace panes. @module editor */
import type {
  DevelopmentIdentity,
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
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { fetchProblem, createWorkspace, restoreDraft, saveDraft } from "./api";
import { HistoryDialog } from "./components/HistoryDialog";
import { ProblemStatement } from "./components/ProblemStatement";
import { ResultContent } from "./components/ResultContent";
import { SaveIndicator, type SaveState } from "./components/SaveIndicator";
import { ResizableDivider } from "./components/ResizableDivider";
import {
  readPreference,
  writePreference,
  type ThemePreference,
} from "./editorSettings";
import {
  clearOwnerRecovery,
  readLatestRecovery,
  writeRecovery,
  type RecoverySnapshot,
} from "./recovery";
import { useTheme } from "./useTheme";
import { useSubmission } from "./useSubmission";
import {
  PythonEditor,
  type PythonEditorHandle,
} from "./PythonEditor";
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
const defaultResultsHeight = 240;

/** Returns a safe short message for load and save failures. */
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Your code is still here.";
}

/** Opens one public problem in the resizable practice workspace. */
export function WorkspacePage({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const [identity, setIdentity] = useState<DevelopmentIdentity>(() =>
    readPreference<DevelopmentIdentity>("quorem.dev-identity.v1", "alice"),
  );
  const { preference: themePreference, setPreference: setThemePreference, theme } = useTheme();
  const [paneRatio, setPaneRatio] = useState(() => readPreference("quorem.pane-ratio.v1", defaultPaneRatio));
  const [resultsHeight, setResultsHeight] = useState(() => readPreference("quorem.results-height.v1", defaultResultsHeight));
  const [activePanel, setActivePanel] = useState<Panel>("code");
  const [problem, setProblem] = useState<ProblemVersion>();
  const [workspace, setWorkspace] = useState<Workspace>();
  const [source, setSource] = useState("");
  const sourceRef = useRef(source);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [localRecovery, setLocalRecovery] = useState<RecoverySnapshot>();
  const [customMode, setCustomMode] = useState(false);
  const [customCasesText, setCustomCasesText] = useState("[{\"args\": []}]");
  const [actionError, setActionError] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shortcutsEnabled, setShortcutsEnabled] = useState(() => readPreference("quorem.shortcuts.v1", true));
  const [fontSize, setFontSize] = useState(() => readPreference("quorem.code-font-size.v1", 15));
  const [tabSize, setTabSize] = useState<2 | 4>(() => readPreference<2 | 4>("quorem.tab-size.v1", 4));
  const [wrap, setWrap] = useState(() => readPreference("quorem.wrap.v1", false));
  const editorRef = useRef<PythonEditorHandle>(null);
  const saveSequence = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const dirtyRef = useRef(false);
  const saveNowRef = useRef<() => Promise<void>>(async () => {});
  const saveTimerRef = useRef<number | undefined>(undefined);
  const draftContextRef = useRef<{
    key: string;
    identity: DevelopmentIdentity;
    workspaceId: string;
    problemVersionId: string;
    editorSessionId: string;
  } | undefined>(undefined);
  const lastQueuedSourceRef = useRef<string | undefined>(undefined);

  const problemQuery = useQuery({
    queryKey: ["problem", identity, slug],
    queryFn: () => fetchProblem(identity, slug),
  });
  const workspaceQuery = useQuery({
    queryKey: ["workspace", identity, problemQuery.data?.id],
    queryFn: () => createWorkspace(identity, problemQuery.data!.id),
    enabled: !!problemQuery.data,
    staleTime: Infinity,
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
    if (previousContext && previousContext.key !== nextContext.key && dirtyRef.current) {
      const snapshot = sourceRef.current;
      void writeRecovery(previousContext.identity, previousContext.workspaceId, previousContext.problemVersionId, snapshot);
      if (snapshot !== lastQueuedSourceRef.current) {
        const sequence = String(++saveSequence.current);
        const pendingSave = saveQueue.current.then(() => saveDraft(previousContext.identity, previousContext.workspaceId, {
          source: snapshot,
          editorSessionId: previousContext.editorSessionId,
          saveSequence: sequence,
        }));
        saveQueue.current = pendingSave.catch(() => {});
      }
    }
    window.clearTimeout(saveTimerRef.current);
    draftContextRef.current = nextContext;
    saveSequence.current = 0;
    lastQueuedSourceRef.current = undefined;
    setProblem(problemQuery.data);
    setWorkspace(workspaceQuery.data);
    const initialSource = workspaceQuery.data.draft.source || problemQuery.data.starterSource;
    setSource(initialSource);
    sourceRef.current = initialSource;
    dirtyRef.current = false;
    setSaveState("saved");
    void readLatestRecovery(identity, workspaceQuery.data.id, problemQuery.data.id)
      .then((snapshot) => {
        if (snapshot && snapshot.source !== initialSource) setLocalRecovery(snapshot);
      })
      .catch(() => setLocalRecovery(undefined));
  }, [problemQuery.data, workspaceQuery.data, identity]);

  useEffect(() => {
    writePreference("quorem.dev-identity.v1", identity);
  }, [identity]);

  useEffect(() => {
    writePreference("quorem.pane-ratio.v1", paneRatio);
  }, [paneRatio]);
  useEffect(() => writePreference("quorem.results-height.v1", resultsHeight), [resultsHeight]);
  useEffect(() => writePreference("quorem.shortcuts.v1", shortcutsEnabled), [shortcutsEnabled]);
  useEffect(() => writePreference("quorem.code-font-size.v1", fontSize), [fontSize]);
  useEffect(() => writePreference("quorem.tab-size.v1", tabSize), [tabSize]);
  useEffect(() => writePreference("quorem.wrap.v1", wrap), [wrap]);

  const updateSource = useCallback((next: string) => {
    sourceRef.current = next;
    const wasDirty = dirtyRef.current;
    dirtyRef.current = true;
    if (!wasDirty) setSaveState("dirty");
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void saveNowRef.current(), 750);
  }, []);

  const saveCurrentDraft = useCallback(async () => {
    const context = draftContextRef.current;
    if (!context || !dirtyRef.current || context.key !== `${identity}:${workspace?.id}:${problem?.id}`) return;
    const snapshot = sourceRef.current;
    if (snapshot === lastQueuedSourceRef.current) return;
    const sequence = String(++saveSequence.current);
    const sessionId = context.editorSessionId;
    const key = context.key;
    setSaveState("saving");
    const recoveryWrite = writeRecovery(context.identity, context.workspaceId, context.problemVersionId, snapshot).catch(() => undefined);
    const task = saveQueue.current.then(() => saveDraft(context.identity, context.workspaceId, {
        source: snapshot,
        editorSessionId: sessionId,
        saveSequence: sequence,
      }));
    lastQueuedSourceRef.current = snapshot;
    saveQueue.current = task.catch(() => {});
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

  useEffect(() => () => window.clearTimeout(saveTimerRef.current), []);

  const execution = useSubmission({ identity, workspace, sourceRef, editorRef, customMode, customCasesText });
  const submission = execution.submission;
  const submissionBusy = execution.busy;
  const admissionPending = execution.admissionPending;
  const run = useCallback(async () => {
    const admitted = await execution.run();
    if (admitted) setActivePanel("results");
  }, [execution.run]);
  const submit = useCallback(async () => {
    const admitted = await execution.submit();
    if (admitted) setActivePanel("results");
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

  const localDirty = saveState !== "saved";
  const recoverLocal = useCallback(async () => {
    if (!localRecovery) return;
    editorRef.current?.replaceSource(localRecovery.source);
    sourceRef.current = localRecovery.source;
    dirtyRef.current = true;
    setSaveState("dirty");
    setLocalRecovery(undefined);
  }, [localRecovery]);

  const restoreHistory = useCallback(async (historicalSource: string, revision: string) => {
    if (!workspace) return;
    await restoreDraft(identity, workspace.id, revision);
    editorRef.current?.replaceSource(historicalSource);
    sourceRef.current = historicalSource;
    dirtyRef.current = false;
    setSaveState("saved");
  }, [identity, workspace]);

  const activeIdentityChanged = useCallback(async (next: DevelopmentIdentity) => {
    if (next === identity) return;
    if (dirtyRef.current && !window.confirm("There are unsaved changes in this workspace. Switch local user anyway?")) return;
    setIdentity(next);
  }, [identity]);

  const dataMatchesRoute = problemQuery.data?.slug === slug
    && workspaceQuery.data?.problemVersionId === problemQuery.data?.id;
  const dataMatchesState = problem?.id === problemQuery.data?.id
    && workspace?.id === workspaceQuery.data?.id;
  const loading = problemQuery.isPending || workspaceQuery.isPending || !dataMatchesRoute || !dataMatchesState || !problem || !workspace;
  const loadError = problemQuery.error ?? workspaceQuery.error;
  const workspaceStyle = { "--problem-ratio": `${paneRatio}%`, "--results-height": `${resultsHeight}px` } as CSSProperties;
  const virtualDocumentUri = "file:///workspace/main.py";
  const editorDocumentKey = workspace ? `${identity}:${workspace.id}:${workspace.problemVersionId}:python` : "pending";

  if (loading) {
    return (
      <main className="workspace-loading" aria-live="polite">
        <div className="loading-mark">Q</div>
        {loadError ? <><h1>Problem unavailable</h1><p>{errorMessage(loadError)}</p><button className="button button-secondary" type="button" onClick={() => { void problemQuery.refetch(); }}>Retry</button></> : <p>Opening workspace…</p>}
      </main>
    );
  }

  return (
    <main className="app-shell" style={workspaceStyle}>
      <header className="topbar">
        <a className="wordmark" href="/run-widths" aria-label="Quorem practice home"><span className="wordmark-mark">Q</span><span>quorem</span></a>
        <div className="topbar-divider" aria-hidden="true" />
        <label className="problem-select-wrap"><span className="sr-only">Choose problem</span><select value={slug} onChange={(event) => { void navigate({ to: "/$slug", params: { slug: event.target.value } }); }}>
          {problemSlugs.map((item) => <option value={item} key={item}>{item.replaceAll("-", " ")}</option>)}
        </select><span className="select-chevron" aria-hidden="true">⌄</span></label>
        <div className="topbar-spacer" />
        <SaveIndicator state={saveState} />
        <div className="topbar-divider" aria-hidden="true" />
        <label className="local-user-wrap"><span className="local-user-label">Local user</span><select aria-label="Local development identity" value={identity} onChange={(event) => { void activeIdentityChanged(event.target.value as DevelopmentIdentity); }}><option value="alice">Alice</option><option value="bob">Bob</option></select></label>
        <label className="theme-wrap"><span className="sr-only">Color theme</span><select aria-label="Color theme" value={themePreference} onChange={(event) => setThemePreference(event.target.value as ThemePreference)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select><span aria-hidden="true">◐</span></label>
        <button className="icon-button history-button" type="button" aria-label="Open draft history" title="Draft history" onClick={() => setHistoryOpen(true)}>↶</button>
      </header>
      <nav className="mobile-tabs" aria-label="Workspace panes">
        {(["problem", "code", "results"] as const).map((panel) => <button key={panel} type="button" aria-current={activePanel === panel ? "page" : undefined} onClick={() => setActivePanel(panel)}>{panel === "problem" ? "Problem" : panel === "code" ? "Code" : "Results"}</button>)}
      </nav>
      <div className="workspace-grid" data-active-panel={activePanel}>
        <section className="problem-pane" aria-label="Problem statement">
          <ProblemStatement problem={problem} />
        </section>
        <ResizableDivider axis="x" value={paneRatio} minimum={30} maximum={65} onChange={setPaneRatio} />
        <section className="coding-pane" aria-label="Python workspace">
          <div className="code-toolbar">
            <div className="code-tab"><span className="python-glyph">Py</span><span>Solution.py</span><span className="file-dot" aria-label={localDirty ? "Unsaved" : "Saved"} /></div>
            <div className="code-options">
              <button className="quiet-button" type="button" onClick={() => void saveCurrentDraft()} title="Save now (Ctrl/Cmd+S)">Save</button>
              <button className="quiet-button history-inline" type="button" onClick={() => setHistoryOpen(true)}>History</button>
              <label className="compact-option"><span className="sr-only">Code font size</span><select value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))}>{[12, 13, 14, 15, 16, 18, 20, 22, 24].map((size) => <option key={size} value={size}>{size}px</option>)}</select></label>
              <label className="compact-option"><span className="sr-only">Indent size</span><select value={tabSize} onChange={(event) => setTabSize(Number(event.target.value) as 2 | 4)}><option value={2}>2 spaces</option><option value={4}>4 spaces</option></select></label>
              <label className="wrap-control"><input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} /><span>Wrap</span></label>
            </div>
          </div>
          {localRecovery && (
            <div className="recovery-banner" role="status"><span>Local recovery from {new Date(localRecovery.savedAt).toLocaleString()}</span><button type="button" onClick={() => void recoverLocal()}>Restore local version</button><button className="banner-dismiss" type="button" aria-label="Dismiss local recovery" onClick={() => setLocalRecovery(undefined)}>×</button></div>
          )}
          <div className="editor-frame">
            <PythonEditor key={editorDocumentKey} ref={editorRef} documentKey={editorDocumentKey} documentUri={virtualDocumentUri} initialSource={source} theme={theme} fontSize={fontSize} tabSize={tabSize} wrap={wrap} onSourceChange={updateSource} />
          </div>
          <div className="editor-footer">
            <span>Python 3.12 <span aria-hidden="true">·</span> UTF-8</span>
            <div className="editor-footer-controls">
              <label className="shortcut-toggle"><input type="checkbox" checked={shortcutsEnabled} onChange={(event) => setShortcutsEnabled(event.target.checked)} /><span>Shortcuts</span></label>
              <button className="clear-recovery" type="button" onClick={() => void clearOwnerRecovery(identity)}>Clear local recovery</button>
            </div>
          </div>
        </section>
        <ResizableDivider axis="y" value={resultsHeight} minimum={170} maximum={480} onChange={setResultsHeight} />
        <section className="results-pane" aria-label="Execution results">
          <div className="results-toolbar">
            <div className="results-label"><span className="eyebrow">Output</span><span className="result-context">{submission?.kind === "submit" ? "Hidden suite summary" : "Public examples"}</span></div>
            <div className="run-actions">
              {submissionBusy && <button className="button button-secondary cancel-button" type="button" onClick={() => void execution.cancel()}>Cancel</button>}
              <button className="button button-secondary" type="button" disabled={submissionBusy} onClick={() => void run()} title="Run (Ctrl/Cmd+Enter)">Run</button>
              <button className="button button-primary" type="button" disabled={submissionBusy} onClick={() => void submit()} title="Submit (Ctrl/Cmd+Shift+Enter)">Submit</button>
            </div>
          </div>
          <div className="results-content" aria-live="polite" aria-atomic="false">
            <ResultContent submission={submission} busy={admissionPending || execution.isPending && !!execution.submissionId} error={execution.error} />
          </div>
          {!submission || submission.kind === "run" ? (
            <div className="custom-input">
              <div className="custom-input-heading"><span>Run inputs</span><label><input type="checkbox" checked={customMode} onChange={(event) => setCustomMode(event.target.checked)} /> Custom cases</label></div>
              {customMode && <><textarea aria-label="Custom cases as JSON" spellCheck={false} value={customCasesText} onChange={(event) => setCustomCasesText(event.target.value)} /><p>Shape: <code>[&#123;"args": [1, "text"]&#125;]</code>. Optional <code>expected</code> compares the result.</p></>}
            </div>
          ) : null}
          {actionError && <p className="action-error" role="alert">{actionError}</p>}
        </section>
      </div>
      {historyOpen && <HistoryDialog identity={identity} workspace={workspace} onClose={() => setHistoryOpen(false)} onRestore={restoreHistory} />}
    </main>
  );
}
