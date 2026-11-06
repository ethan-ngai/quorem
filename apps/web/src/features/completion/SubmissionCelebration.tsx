/** @file SubmissionCelebration.tsx @description Nonblocking completion feedback for shared interview audiences. @module completion */
import { useState } from "react";
import type { Submission } from "@quorem/contracts";
import { Celebration } from "../../ui/Celebration";
import type { CompletionOutcome } from "../../ui/completionOutcome";
import { useCompletionEvent } from "./useCompletionEvent";

export function SubmissionCelebration({
  scope,
  submission,
  outcome,
  enabled = true,
}: {
  scope: string;
  submission?: Submission;
  outcome: CompletionOutcome;
  enabled?: boolean;
}) {
  const [event, setEvent] = useState<{ scope: string; id: string }>();
  useCompletionEvent({
    scope,
    submission,
    enabled,
    onAccepted: ({ id }) => setEvent({ scope, id }),
  });
  return enabled && event?.scope === scope ? (
    <Celebration key={event.id} outcome={outcome} inline />
  ) : null;
}
