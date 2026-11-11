/** @file useWorkspaceDraft.ts @description Owns editor draft persistence and recovery. @module editor */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { DevelopmentIdentity, PublishedQuestion, Workspace } from "@quorem/contracts";
import type { PythonEditorHandle } from "./PythonEditor";
import type { SaveState } from "./components/SaveIndicator";
import { readCustomDrafts, writeCustomDrafts, type CustomCaseDraft } from "./customCases";
import {
  browserDraftScope,
  createBrowserDraftWriter,
  readBrowserDraft,
  readLatestRecovery,
  writeBrowserDraft,
} from "./recovery";

export function useWorkspaceDraft({
  identity,
  accountPresent,
  queriedProblem,
  loadedWorkspace,
  editorRef,
  initialSource: providedInitialSource,
  canEdit = true,
  authoritative = false,
  onError,
  saveMatchSource,
}: {
  identity: DevelopmentIdentity;
  accountPresent: boolean;
  queriedProblem?: PublishedQuestion;
  loadedWorkspace?: Workspace;
  editorRef: RefObject<PythonEditorHandle | null>;
  initialSource?: string;
  canEdit?: boolean;
  authoritative?: boolean;
  onError: (error: unknown) => void;
  saveMatchSource?: (workspaceId: string, source: string) => Promise<void>;
}) {
  const editable = useRef(canEdit);
  editable.current = canEdit;
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  const matchSourceSaver = useRef(saveMatchSource);
  matchSourceSaver.current = saveMatchSource;
  const [problem, setProblem] = useState<PublishedQuestion>();
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
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = undefined;
    draftContextRef.current = nextContext;
    lastQueuedSourceRef.current = undefined;
    setProblem(queriedProblem);
    setWorkspace(loadedWorkspace);
    setCustomMode(false);
    setCustomDrafts(readCustomDrafts(nextContext.key, queriedProblem));
    const initialSource = authoritative
      ? (providedInitialSource ?? "")
      : (readBrowserDraft(identity, nextContext.storageId, queriedProblem.id) ??
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
        queriedProblem.starterSource);
    setSource(initialSource);
    sourceRef.current = initialSource;
    dirtyRef.current = false;
    setSaveState("saved");
  }, [
    queriedProblem,
    loadedWorkspace,
    identity,
    accountPresent,
    providedInitialSource,
    authoritative,
  ]);

  useEffect(() => {
    if (authoritative || !workspace || !problem || draftContextRef.current?.identity !== identity)
      return;
    let active = true;
    const context = draftContextRef.current;
    const generation = editGeneration.current;
    const hasAutosave = () =>
      readBrowserDraft(identity, context.storageId, problem.id) !== undefined ||
      (accountPresent &&
        readBrowserDraft("anonymous" as DevelopmentIdentity, context.storageId, problem.id) !==
          undefined);
    if (hasAutosave()) return;
    const load = async () => {
      const snapshot =
        (await readLatestRecovery(identity, context.storageId, problem.id)) ??
        (context.storageId !== workspace.id
          ? await readLatestRecovery(identity, workspace.id, problem.id)
          : undefined);
      if (active && snapshot && editGeneration.current === generation && !hasAutosave()) {
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
  }, [workspace, problem, identity, accountPresent, authoritative, editorRef]);

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
    if (matchSourceSaver.current && saveTimerRef.current !== undefined) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined;
      void saveNowRef.current();
    }, 750);
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
    if (snapshot === lastQueuedSourceRef.current) {
      await saveQueue.current;
      return;
    }
    setSaveState("saving");
    const persist = matchSourceSaver.current;
    const task = persist
      ? saveQueue.current.then(async () => {
          if (draftContextRef.current === context && sourceRef.current === snapshot) {
            await persist(context.workspaceId, snapshot);
          }
        })
      : undefined;
    if (task) {
      lastQueuedSourceRef.current = snapshot;
      saveQueue.current = task.catch(() => {});
    }
    try {
      try {
        browserWriterRef.current?.flush();
      } finally {
        // Match review still needs the latest code if browser storage fails.
        if (task) await task;
      }
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
    };
    const onPageHide = () => {
      preserveDraft();
      if (matchSourceSaver.current) void saveNowRef.current();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.clearTimeout(saveTimerRef.current);
      preserveDraft(false);
      draftContextRef.current = undefined;
    };
  }, []);

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
  };
}
