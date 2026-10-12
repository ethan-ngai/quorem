/** @file SaveIndicator.tsx @description Announces draft persistence state. @module editor */
import { Tooltip } from "./Tooltip";

export type SaveState = "saved" | "dirty" | "saving" | "offline" | "error";

/** Displays a quiet, text-backed save status. */
export function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  const label = {
    saved: "Saved in this browser",
    dirty: "Unsaved changes",
    saving: "Saving…",
    offline: "Offline · saved locally",
    error: "Browser save failed",
  }[state];
  const actionable = state === "offline" || state === "error";
  const content = (
    <>
      <i aria-hidden="true" />
      <span className={actionable ? undefined : "sr-only"}>{label}</span>
    </>
  );
  if (actionable && onRetry)
    return (
      <Tooltip content={`${label}. Click to retry saving.`}>
        <button
          className={`save-indicator save-${state} save-retry`}
          type="button"
          onClick={onRetry}
          aria-label={`${label}. Retry saving.`}
        >
          {content}
        </button>
      </Tooltip>
    );
  return (
    <Tooltip content={label}>
      <span tabIndex={0} className={`save-indicator save-${state}`} role="status">
        {content}
      </span>
    </Tooltip>
  );
}
