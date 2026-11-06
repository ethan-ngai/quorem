/** @file useWorkspaceDraft.ts @description Owns editor draft persistence and recovery. @module editor */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { DevelopmentIdentity, ProblemVersion, Workspace } from "@quorem/contracts";
import type { PythonEditorHandle } from "./PythonEditor";
import type { SaveState } from "./components/SaveIndicator";
import { readCustomDrafts, writeCustomDrafts, type CustomCaseDraft } from "./customCases";
import {
  browserDraftScope,
  createBrowserDraftWriter,
  readBrowserDraft,
  readLatestRecovery,
  writeBrowserDraft,
  writeRecovery,
} from "./recovery";

export function useWorkspaceDraft({
  identity,
  accountPresent,
  queriedProblem,
  loadedWorkspace,
  editorRef,
  initialSource: providedInitialSource,
  canEdit = true,
  onError,
}: {
  identity: DevelopmentIdentity;
  accountPresent: boolean;
  queriedProblem?: ProblemVersion;
  loadedWorkspace?: Workspace;
  editorRef: RefObject<PythonEditorHandle | null>;
  initialSource?: string;
  canEdit?: boolean;
  onError: (error: unknown) => void;
}) {
  const editable = useRef(canEdit);
  editable.current = canEdit;
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  const [problem, setProblem] = useState<ProblemVersion>();
  const [workspace, setWorkspace] = useState<Workspace>();
  const [source, setSource] = useState("");
  const sourceRef = useRef(source);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [customMode, setCustomMode] = useState(false);
  const [customDrafts, setCustomDrafts] = useState<CustomCaseDraft[]>([]);
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
        errorHandler.current(error);
      }
    });
  }

  useEffect(() => {
    if (!queriedProblem || !loadedWorkspace) return;
    const nextContext = {
      key: `${identity}:${loadedWorkspace.id}:${queriedProblem.id}`,
      identity,
      workspaceId: loadedWorkspace.id,
      problemVersionId: queriedProblem.id,
      storageId: browserDraftScope(loadedWorkspace),
    };
    const previousContext = draftContextRef.current;
    if (previousContext?.key === nextContext.key) return;
    try {
      browserWriterRef.current?.flush();
    } catch (error) {
      errorHandler.current(error);
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
    setProblem(queriedProblem);
    setWorkspace(loadedWorkspace);
    setCustomMode(false);
    setCustomDrafts(readCustomDrafts(nextContext.key, queriedProblem));
    const initialSource =
      readBrowserDraft(identity, nextContext.storageId, queriedProblem.id) ??
      (accountPresent
        ? readBrowserDraft(
            "anonymous" as DevelopmentIdentity,
            nextContext.storageId,
            queriedProblem.id,
          )
        : undefined) ??
      providedInitialSource ??
      queriedProblem.languages?.find((item) => item.language === loadedWorkspace.language)
        ?.starterSource ??
      queriedProblem.starterSource;
    setSource(initialSource);
    sourceRef.current = initialSource;
    dirtyRef.current = false;
    setSaveState("saved");
  }, [queriedProblem, loadedWorkspace, identity, accountPresent, providedInitialSource]);

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
    if (!editable.current) return;
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
      if (draftContextRef.current !== context) return;
      if (sourceRef.current === snapshot) {
        dirtyRef.current = false;
        setSaveState("saved");
      } else {
        setSaveState("dirty");
      }
    } catch (error) {
      if (draftContextRef.current !== context) return;
      if (lastQueuedSourceRef.current === snapshot) lastQueuedSourceRef.current = undefined;
      setSaveState("error");
      errorHandler.current(error);
    }
  }, [identity, problem, workspace]);
  saveNowRef.current = saveCurrentDraft;

  useEffect(() => {
    const preserveDraft = (notify = true) => {
      try {
        browserWriterRef.current?.flush();
      } catch (error) {
        if (notify) {
          setSaveState("error");
          errorHandler.current(error);
        }
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
    const onPageHide = () => preserveDraft();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.clearTimeout(saveTimerRef.current);
      preserveDraft(false);
      draftContextRef.current = undefined;
    };
  }, []);

  const restoreHistory = useCallback(
    async (historicalSource: string) => {
      if (!workspace || !editable.current) return;
      const context = draftContextRef.current;
      const generation = editGeneration.current;
      await saveCurrentDraft();
      await saveQueue.current;
      if (draftContextRef.current !== context || !editable.current) return;
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
      if (draftContextRef.current === context && editGeneration.current === restoredGeneration) {
        dirtyRef.current = false;
        window.clearTimeout(saveTimerRef.current);
        setSaveState("saved");
      }
    },
    [identity, workspace, saveCurrentDraft],
  );

  const changeCustomDrafts = useCallback((drafts: CustomCaseDraft[]) => {
    if (!editable.current) return;
    setCustomDrafts(drafts);
    const context = draftContextRef.current;
    if (context) writeCustomDrafts(context.key, drafts);
  }, []);
  const saveBeforeSwitch = async () => {
    await saveCurrentDraft();
    if (dirtyRef.current) throw new Error("Save the current draft before switching language.");
  };
  return {
    problem,
    workspace,
    source,
    sourceRef,
    saveState,
    customMode,
    setCustomMode,
    customDrafts,
    changeCustomDrafts,
    contextKey: draftContextRef.current?.key,
    updateSource,
    saveCurrentDraft,
    saveBeforeSwitch,
    restoreHistory,
  };
}
