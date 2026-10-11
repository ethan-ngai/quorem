/** @file useSubmission.ts @description Dispatches, resumes, and cancels judge jobs. @module editor */
import type { DevelopmentIdentity, Workspace } from "@quorem/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { cancelSubmission, createSubmission, fetchSubmission } from "./api";
import { parseCustomCases } from "./customCases";
import { submissionStorageKey } from "./editorSettings";
import type { PythonEditorHandle } from "./PythonEditor";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Judge request failed. Your code is still here.";
}

/** Keeps one server job attached to a workspace and recovers it after reload. */
export function useSubmission({
  identity,
  workspace,
  sourceRef,
  editorRef,
  customMode,
  customCasesText,
  enabled = true,
}: {
  identity: DevelopmentIdentity;
  workspace?: Workspace;
  sourceRef: MutableRefObject<string>;
  editorRef: MutableRefObject<PythonEditorHandle | null>;
  customMode: boolean;
  customCasesText: string;
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<{ scope: string; id: string }>();
  const [admissionPending, setAdmissionPending] = useState(false);
  const [error, setError] = useState<string>();
  const admissionLock = useRef(false);
  const pendingRequest = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const scope = workspace ? `${identity}:${workspace.id}` : "";
  const activeSubmissionId = active?.scope === scope ? active.id : undefined;

  useEffect(() => {
    if (!workspace) return;
    const id = localStorage.getItem(submissionStorageKey(identity, workspace.id));
    setActive(id ? { scope, id } : undefined);
  }, [identity, scope, workspace]);

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
      if (!enabled || !workspace || admissionLock.current || busy) return false;
      let customCases;
      if (kind === "run" && customMode) {
        try {
          customCases = parseCustomCases(customCasesText);
        } catch (cause) {
          setError(errorMessage(cause));
          return false;
        }
      }
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
        setActive({ scope, id: admission.id });
        pendingRequest.current = undefined;
        try {
          localStorage.setItem(submissionStorageKey(identity, workspace.id), admission.id);
          localStorage.removeItem(recoveryKey);
        } catch {
          /* The live result still has an authoritative submission ID. */
        }
        await queryClient.invalidateQueries({ queryKey: ["submission", identity, admission.id] });
        return true;
      } catch (cause) {
        setError(errorMessage(cause));
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
      customCasesText,
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
