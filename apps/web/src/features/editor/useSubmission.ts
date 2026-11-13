import type { RuleApproval } from "@quorem/contracts/match-rules";
import { sha256 } from "../../sha256";
/** @file useSubmission.ts @description Dispatches, resumes, and cancels judge jobs. @module editor */
import { useErrorNotification } from "../../ui/Notifications";
import { userFacingErrorMessage } from "../../ui/errors";
import type {
  DevelopmentIdentity,
  PublishedQuestion,
  Submission,
  Workspace,
} from "@quorem/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { cancelSubmission, createSubmission, fetchSubmission, SubmissionReadError } from "./api";
import { submissionStream } from "./submissionStream";
import { forgetMissingSubmission } from "./submissionRecovery";
import {
  parseRunSnapshotCases,
  parseProblemDrafts,
  createRunSnapshot,
  type CustomCaseDraft,
  type RunSnapshot,
} from "./customCases";
import { submissionStorageKey } from "./editorSettings";
import {
  clearPendingExecution,
  pendingExecution,
  type PendingExecution,
} from "../execution/pendingExecution";
import type { PythonEditorHandle } from "./PythonEditor";

function errorMessage(error: unknown) {
  return userFacingErrorMessage(error, "Judge request failed. Your code is still here.");
}

/** Keeps one server job attached to a workspace and recovers it after reload. */
export function useSubmission({
  identity,
  workspace,
  sourceRef,
  editorRef,
  customMode,
  drafts,
  problem,
  enabled = true,
  level,
  runExamples,
  practiceTarget,
  beforeExecution,
  sharedSubmissionId,
}: {
  identity: DevelopmentIdentity;
  workspace?: Workspace;
  sourceRef: MutableRefObject<string>;
  editorRef: MutableRefObject<PythonEditorHandle | null>;
  customMode: boolean;
  drafts: CustomCaseDraft[];
  problem?: PublishedQuestion;
  enabled?: boolean;
  beforeExecution?: (kind: "run" | "submit") => Promise<boolean>;
  sharedSubmissionId?: string;
  level?: number;
  practiceTarget?: import("@quorem/contracts/match-rules").AcceptancePolicy;
  runExamples?: PublishedQuestion["examples"];
}) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<{
    scope: string;
    id: string;
    level?: number;
    kind?: Submission["kind"];
  }>();
  const [admittingKind, setAdmittingKind] = useState<Submission["kind"]>();
  const admissionPending = admittingKind !== undefined;
  const [error, setError] = useState<string>();
  useErrorNotification(error);
  const [runSnapshot, setRunSnapshot] = useState<{
    scope: string;
    submissionId: string;
    value: RunSnapshot;
  }>();
  const admissionLock = useRef(false);
  const abortLock = useRef(false);
  const [abortingId, setAbortingId] = useState<string>();
  const pendingRequest = useRef<PendingExecution | undefined>(undefined);
  const scope = workspace ? `${identity}:${workspace.id}` : "";
  const activeSubmissionId =
    sharedSubmissionId ?? (active?.scope === scope ? active.id : undefined);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  useEffect(() => {
    if (!workspace) return;
    let id: string | null = null;
    try {
      id = localStorage.getItem(submissionStorageKey(identity, workspace.id));
    } catch {
      /* Live execution does not require browser storage. */
    }
    setActive(id ? { scope, id } : undefined);
    setError(undefined);
    setRunSnapshot(undefined);
    // Stateful recovery uses authoritative server outputs rather than locally stored call metadata.
    if (!id || !problem || problem.odyssey) return;
    try {
      const raw: unknown = JSON.parse(
        localStorage.getItem(`${submissionStorageKey(identity, workspace.id)}:snapshot:${id}`) ??
          "null",
      );
      if (
        !raw ||
        typeof raw !== "object" ||
        !("problemVersionId" in raw) ||
        raw.problemVersionId !== problem.id ||
        !("custom" in raw) ||
        typeof raw.custom !== "boolean" ||
        !("cases" in raw) ||
        !Array.isArray(raw.cases)
      )
        return;
      const serialized = JSON.stringify(
        raw.cases.map((item: { value: unknown }) =>
          item.value && typeof item.value === "object"
            ? { ...item.value, explanation: undefined }
            : item.value,
        ),
      );
      const values = parseRunSnapshotCases(serialized, problem);
      if (
        !raw.cases.every(
          (item: unknown) =>
            item && typeof item === "object" && "id" in item && typeof item.id === "string",
        )
      )
        return;
      const restored: RunSnapshot = {
        problemVersionId: problem.id,
        custom: raw.custom,
        cases: raw.cases.map((item: { id: string }, index: number) => ({
          id: item.id,
          value: values[index]!,
        })),
      };
      setRunSnapshot({ scope, submissionId: id, value: restored });
    } catch {
      /* Output remains available when its input snapshot is unavailable. */
    }
  }, [identity, scope, workspace, problem]);

  const submissionQuery = useQuery<Submission>({
    queryKey: ["submission", identity, activeSubmissionId],
    queryFn: ({ signal }) => fetchSubmission(identity, activeSubmissionId!, signal),
    enabled: !!activeSubmissionId,
    staleTime: Infinity,
    retry: (count, cause) =>
      !(cause instanceof SubmissionReadError && [401, 403, 404].includes(cause.status)) &&
      count < 1,
    refetchOnWindowFocus: (query) => query.state.status === "error",
    refetchOnReconnect: (query) => query.state.status === "error",
    refetchInterval: ({ state }) =>
      (state.data?.state === "running" ||
        (abortingId === activeSubmissionId && state.data?.state === "queued")) &&
      !(state.error instanceof SubmissionReadError && [401, 403, 404].includes(state.error.status))
        ? 1000
        : false,
  });
  const submission = submissionQuery.data;
  const canAbort =
    !admissionPending &&
    (submission?.state === "queued" || submission?.state === "running") &&
    submission.canCancel !== false;
  const abortPending = canAbort && abortingId === submission.id;
  const streaming =
    !!activeSubmissionId &&
    !submissionQuery.isPending &&
    !(
      submissionQuery.error instanceof SubmissionReadError && submissionQuery.error.status === 404
    ) &&
    (!submission || submission.state === "queued" || submission.state === "running");
  useEffect(() => {
    if (!submissionQuery.isError || !activeSubmissionId || !workspace || scopeRef.current !== scope)
      return;
    const cause = submissionQuery.error;
    if (
      !forgetMissingSubmission(
        cause,
        submissionStorageKey(identity, workspace.id),
        activeSubmissionId,
      )
    ) {
      setError(errorMessage(cause));
      return;
    }
    setError(undefined);
    setRunSnapshot(undefined);
    setActive((current) =>
      current?.scope === scope && current.id === activeSubmissionId ? undefined : current,
    );
  }, [
    submissionQuery.isError,
    submissionQuery.error,
    activeSubmissionId,
    workspace,
    scope,
    identity,
  ]);
  useEffect(() => {
    if (!streaming || !activeSubmissionId || !workspace) return;
    const stream = submissionStream(
      activeSubmissionId,
      () => {
        setError(undefined);
        void queryClient.invalidateQueries({
          queryKey: ["submission", identity, activeSubmissionId],
        });
      },
      () => setError("Judge connection interrupted. Reconnecting…"),
    );
    stream.start();
    return () => stream.stop();
  }, [streaming, activeSubmissionId, workspace?.id, identity, queryClient]);
  const busy =
    admissionLock.current ||
    admissionPending ||
    (!!activeSubmissionId && submissionQuery.isPending) ||
    submission?.state === "queued" ||
    submission?.state === "running";

  const replaceableRun =
    workspace?.kind === "solo" &&
    active?.scope === scope &&
    active.level === level &&
    submission?.kind === "run" &&
    (submission.state === "queued" || submission.state === "running")
      ? submission.id
      : undefined;

  const dispatch = useCallback(
    async (kind: "run" | "submit", approval?: RuleApproval, frozenSource?: string) => {
      const replacement = kind === "run" ? replaceableRun : undefined;
      if (
        !enabled ||
        !workspace ||
        !problem ||
        admissionLock.current ||
        abortLock.current ||
        abortPending ||
        (busy && !replacement)
      )
        return false;
      let customCases;
      if (kind === "run" && customMode) {
        try {
          customCases = parseProblemDrafts(drafts, problem);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Check the custom cases.");
          return false;
        }
      }
      const snapshot =
        kind === "run"
          ? createRunSnapshot(
              problem.id,
              customCases ?? runExamples ?? problem.examples,
              customMode ? drafts : undefined,
            )
          : undefined;
      admissionLock.current = true;
      setAdmittingKind(kind);
      setError(undefined);
      try {
        if (beforeExecution && !(await beforeExecution(kind))) return false;
        const source = frozenSource ?? editorRef.current?.getSource() ?? sourceRef.current;
        if (replacement) {
          let previous = await cancelSubmission(identity, replacement);
          const deadline = Date.now() + 30_000;
          while (previous.state === "queued" || previous.state === "running") {
            if (scopeRef.current !== scope) return false;
            if (Date.now() >= deadline)
              throw new Error("The previous run is still stopping. Try again.");
            await new Promise((resolve) => setTimeout(resolve, 500));
            previous = await fetchSubmission(identity, replacement);
          }
          if (scopeRef.current !== scope) return false;
        }
        const target = kind === "submit" ? practiceTarget : undefined;
        const fingerprint = await sha256(
          JSON.stringify({ scope, kind, source, customCases, level, approval, target }),
        );
        const recoveryKey = `${submissionStorageKey(identity, workspace.id)}:pending`;
        pendingRequest.current = pendingExecution(recoveryKey, fingerprint, pendingRequest.current);
        const admission = await createSubmission(
          identity,
          workspace.id,
          kind,
          source,
          customCases,
          pendingRequest.current.key,
          level,
          approval,
          target,
        );
        if (scopeRef.current === scope) {
          setActive({ scope, id: admission.id, level, kind });
          setRunSnapshot(
            snapshot ? { scope, submissionId: admission.id, value: snapshot } : undefined,
          );
        }
        try {
          const previousId = localStorage.getItem(submissionStorageKey(identity, workspace.id));
          if (previousId && previousId !== admission.id)
            localStorage.removeItem(
              `${submissionStorageKey(identity, workspace.id)}:snapshot:${previousId}`,
            );
          localStorage.setItem(submissionStorageKey(identity, workspace.id), admission.id);
          clearPendingExecution(recoveryKey, pendingRequest.current.key);
          if (snapshot)
            localStorage.setItem(
              `${submissionStorageKey(identity, workspace.id)}:snapshot:${admission.id}`,
              JSON.stringify(snapshot),
            );
        } catch {
          /* The live result still has an authoritative submission ID. */
        }
        pendingRequest.current = undefined;
        return scopeRef.current === scope;
      } catch (cause) {
        if (scopeRef.current === scope) setError(errorMessage(cause));
        return false;
      } finally {
        admissionLock.current = false;
        setAdmittingKind(undefined);
      }
    },
    [
      workspace,
      identity,
      busy,
      replaceableRun,
      abortPending,
      customMode,
      drafts,
      problem,
      runExamples,
      editorRef,
      sourceRef,
      scope,
      queryClient,
      enabled,
      beforeExecution,
      level,
      practiceTarget,
    ],
  );

  const cancel = useCallback(async () => {
    if (!canAbort || !submission || abortPending || abortLock.current || admissionLock.current)
      return;
    abortLock.current = true;
    setAbortingId(submission.id);
    setError(undefined);
    try {
      await cancelSubmission(identity, submission.id);
    } catch (cause) {
      if (scopeRef.current === scope) setError(errorMessage(cause));
      setAbortingId(undefined);
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["submission", identity, submission.id] });
      abortLock.current = false;
    }
  }, [abortPending, canAbort, identity, queryClient, scope, submission]);

  const run = useCallback(() => dispatch("run"), [dispatch]);
  const submit = useCallback(
    (approval?: RuleApproval, frozenSource?: string) => dispatch("submit", approval, frozenSource),
    [dispatch],
  );

  return {
    submission,
    runSnapshot:
      runSnapshot?.scope === scope && runSnapshot.submissionId === activeSubmissionId
        ? runSnapshot.value
        : undefined,
    submissionId: activeSubmissionId,
    isPending: submissionQuery.isPending,
    busy,
    admissionPending,
    pendingKind:
      admittingKind ??
      (submissionQuery.isPending && active?.id === activeSubmissionId ? active?.kind : undefined),
    canReplaceRun: !!replaceableRun && !admissionPending && !abortPending,
    canAbort,
    abortPending,
    error,
    run,
    submit,
    cancel,
    clearResult: useCallback(() => {
      setActive(undefined);
      setRunSnapshot(undefined);
      setError(undefined);
      if (workspace) {
        try {
          localStorage.removeItem(submissionStorageKey(identity, workspace.id));
        } catch {
          /* Storage may be unavailable. */
        }
      }
    }, [identity, workspace]),
    clearError: useCallback(() => setError(undefined), []),
  };
}
