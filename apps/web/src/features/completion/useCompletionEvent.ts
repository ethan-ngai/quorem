/** @file useCompletionEvent.ts @description Deduplicated accepted-Submit events across personal and shared workspaces. @module completion */
import { useEffect, useRef } from "react";
import type { Submission } from "@quorem/contracts";

export function useCompletionEvent({
  scope,
  submission,
  enabled = true,
  onAccepted,
}: {
  scope: string;
  submission?: Submission;
  enabled?: boolean;
  onAccepted: (submission: Submission) => void;
}) {
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (
      !enabled ||
      !submission ||
      submission.kind !== "submit" ||
      submission.state !== "completed" ||
      submission.verdict !== "accepted"
    )
      return;
    const event = `${scope}:${submission.id}`;
    if (seen.current.has(event)) return;
    seen.current.add(event);
    const key = `quorem.celebrated.${scope}`;
    try {
      if (sessionStorage.getItem(key) === submission.id) return;
      sessionStorage.setItem(key, submission.id);
    } catch {
      /* Live feedback also works without browser storage. */
    }
    onAccepted(submission);
  }, [scope, submission, enabled, onAccepted]);
}
