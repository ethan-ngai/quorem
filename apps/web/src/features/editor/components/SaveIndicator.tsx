/** @file SaveIndicator.tsx @description Shows draft persistence failures and recovery. @module editor */
import { Tooltip } from "../../../ui/Tooltip";

export type SaveState = "saved" | "dirty" | "saving" | "offline" | "error";

/** Keep routine autosaves silent; surface failures with retry. */
export function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  if (state !== "offline" && state !== "error") return null;
  const label = {
    offline: "Offline · saved locally",
    error: "Browser save failed",
  }[state];
  const content = (
    <>
      <i aria-hidden="true" />
      <span>{label}</span>
    </>
  );
  if (onRetry)
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
