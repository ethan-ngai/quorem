/** @file useSubmission.ts @description Dispatches, resumes, and cancels judge jobs. @module editor */
import { useErrorNotification } from "../../ui/Notifications";
import { userFacingErrorMessage } from "../../ui/errors";
import type { DevelopmentIdentity, ProblemVersion, Workspace } from "@quorem/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { cancelSubmission, createSubmission, fetchSubmission } from "./api";
import {
  parseCustomCases,
  parseCustomDrafts,
  type CustomCaseDraft,
  type RunSnapshot,
} from "./customCases";
import { submissionStorageKey } from "./editorSettings";
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
}: {
  identity: DevelopmentIdentity;
  workspace?: Workspace;
  sourceRef: MutableRefObject<string>;
  editorRef: MutableRefObject<PythonEditorHandle | null>;
  customMode: boolean;
  drafts: CustomCaseDraft[];
  problem?: ProblemVersion;
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<{ scope: string; id: string }>();
  const [admissionPending, setAdmissionPending] = useState(false);
  const [error, setError] = useState<string>();
  useErrorNotification(error);
  const [runSnapshot, setRunSnapshot] = useState<{
    scope: string;
    submissionId: string;
    value: RunSnapshot;
  }>();
  const admissionLock = useRef(false);
  const pendingRequest = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const scope = workspace ? `${identity}:${workspace.id}` : "";
  const activeSubmissionId = active?.scope === scope ? active.id : undefined;
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
    if (!id || !problem) return;
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
      const values = parseCustomCases(
        JSON.stringify(
          raw.cases.map((item: { value: unknown }) =>
            item.value && typeof item.value === "object"
              ? { ...item.value, explanation: undefined }
              : item.value,
          ),
        ),
        problem.signature,
      );
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

  const submissionQuery = useQuery({
    queryKey: ["submission", identity, activeSubmissionId],
    queryFn: () => fetchSubmission(identity, activeSubmissionId!),
    enabled: !!activeSubmissionId,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "queued" || state === "running" ? 800 : false;
    },
  });
  const submission = submissionQuery.data;
  const busy =
    admissionLock.current ||
    admissionPending ||
    (!!activeSubmissionId && submissionQuery.isPending) ||
    submission?.state === "queued" ||
    submission?.state === "running";

  const dispatch = useCallback(
    async (kind: "run" | "submit") => {
      if (!enabled || !workspace || !problem || admissionLock.current || busy) return false;
      let customCases;
      if (kind === "run" && customMode) {
        try {
          customCases = parseCustomDrafts(drafts, problem.signature, problem.constraints);
        } catch (cause) {
          setError(errorMessage(cause));
          return false;
        }
      }
      const snapshot: RunSnapshot | undefined =
        kind === "run"
          ? {
              problemVersionId: problem.id,
              custom: customMode,
              cases: (customCases ?? problem.examples).map((value, index) => ({
                id: customMode ? drafts[index]!.id : String(index),
                value: {
                  args: value.args,
                  ...(value.expected !== undefined ? { expected: value.expected } : {}),
                },
              })),
            }
          : undefined;
      const source = editorRef.current?.getSource() ?? sourceRef.current;
      admissionLock.current = true;
      setAdmissionPending(true);
      setError(undefined);
      try {
        const bytes = new TextEncoder().encode(
          JSON.stringify({ scope, kind, source, customCases }),
        );
        const fingerprint = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
        const recoveryKey = `${submissionStorageKey(identity, workspace.id)}:pending`;
        try {
          const stored = localStorage.getItem(recoveryKey);
          if (stored) {
            const recovered: unknown = JSON.parse(stored);
            if (
              recovered &&
              typeof recovered === "object" &&
              "fingerprint" in recovered &&
              recovered.fingerprint === fingerprint &&
              "key" in recovered &&
              typeof recovered.key === "string"
            )
              pendingRequest.current = { fingerprint, key: recovered.key };
          }
        } catch {
          /* Browser storage may be unavailable; the current tab retains its retry key. */
        }
        if (pendingRequest.current?.fingerprint !== fingerprint)
          pendingRequest.current = { fingerprint, key: crypto.randomUUID() };
        try {
          localStorage.setItem(recoveryKey, JSON.stringify(pendingRequest.current));
        } catch {
          /* Execution remains available without browser storage. */
        }
        const admission = await createSubmission(
          identity,
          workspace.id,
          kind,
          source,
          customCases,
          pendingRequest.current.key,
        );
        if (scopeRef.current === scope) {
          setActive({ scope, id: admission.id });
          setRunSnapshot(
            snapshot ? { scope, submissionId: admission.id, value: snapshot } : undefined,
          );
        }
        pendingRequest.current = undefined;
        try {
          const previousId = localStorage.getItem(submissionStorageKey(identity, workspace.id));
          if (previousId && previousId !== admission.id)
            localStorage.removeItem(
              `${submissionStorageKey(identity, workspace.id)}:snapshot:${previousId}`,
            );
          localStorage.setItem(submissionStorageKey(identity, workspace.id), admission.id);
          localStorage.removeItem(recoveryKey);
          if (snapshot)
            localStorage.setItem(
              `${submissionStorageKey(identity, workspace.id)}:snapshot:${admission.id}`,
              JSON.stringify(snapshot),
            );
        } catch {
          /* The live result still has an authoritative submission ID. */
        }
        await queryClient.invalidateQueries({ queryKey: ["submission", identity, admission.id] });
        return scopeRef.current === scope;
      } catch (cause) {
        if (scopeRef.current === scope) setError(errorMessage(cause));
        return false;
      } finally {
        admissionLock.current = false;
        setAdmissionPending(false);
      }
    },
    [
      workspace,
      identity,
      busy,
      customMode,
      drafts,
      problem,
      editorRef,
      sourceRef,
      scope,
      queryClient,
      enabled,
    ],
  );

  const cancel = useCallback(async () => {
    if (!submission || !busy || (submission.kind === "submit" && workspace?.kind === "match"))
      return;
    try {
      await cancelSubmission(identity, submission.id);
      await queryClient.invalidateQueries({ queryKey: ["submission", identity, submission.id] });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [identity, queryClient, submission, busy, workspace]);

  const run = useCallback(() => dispatch("run"), [dispatch]);
  const submit = useCallback(() => dispatch("submit"), [dispatch]);

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
    error,
    run,
    submit,
    cancel,
    clearError: useCallback(() => setError(undefined), []),
  };
}
