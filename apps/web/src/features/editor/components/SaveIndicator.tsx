/** @file SaveIndicator.tsx @description Announces draft persistence state. @module editor */

export type SaveState = "saved" | "dirty" | "saving" | "offline" | "error";

/** Displays a quiet, text-backed save status. */
export function SaveIndicator({ state }: { state: SaveState }) {
  const label = {
    saved: "All changes saved",
    dirty: "Unsaved changes",
    saving: "Saving…",
    offline: "Offline · saved locally",
    error: "Save failed · retry available",
  }[state];
  return (
    <span className={`save-indicator save-${state}`} role="status" title={label}>
      <i aria-hidden="true" />
      <span
        className={
          state === "saved" || state === "saving" || state === "dirty" ? "sr-only" : undefined
        }
      >
        {label}
      </span>
    </span>
  );
}
