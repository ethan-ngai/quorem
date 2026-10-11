/** @file SaveIndicator.tsx @description Announces draft persistence state. @module editor */

export type SaveState = "saved" | "dirty" | "saving" | "offline" | "error";

/** Displays a quiet, text-backed save status. */
export function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  const label = {
    saved: "All changes saved",
    dirty: "Unsaved changes",
    saving: "Saving…",
    offline: "Offline · saved locally",
    error: "Save failed",
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
      <button
        className={`save-indicator save-${state} save-retry`}
        type="button"
        onClick={onRetry}
        title={`${label}. Click to retry saving.`}
        aria-label={`${label}. Retry saving.`}
      >
        {content}
      </button>
    );
  return (
    <span className={`save-indicator save-${state}`} role="status" title={label}>
      {content}
    </span>
  );
}
