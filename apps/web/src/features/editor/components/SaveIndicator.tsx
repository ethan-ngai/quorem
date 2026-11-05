/** @file SaveIndicator.tsx @description Shows draft persistence failures and recovery. @module editor */
import { PersistentNotice } from "../../../ui/PersistentNotice";

export type SaveState = "saved" | "dirty" | "saving" | "offline" | "error";

/** Keep routine autosaves silent; surface failures with retry. */
export function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  return (
    <PersistentNotice
      label={state === "offline" ? "Offline · saved locally" : "Browser save failed"}
      severity={state === "offline" ? "warning" : "error"}
      message={
        state === "offline"
          ? "Your code is saved locally in this browser."
          : state === "error"
            ? "Could not save your code in this browser. Retry saving before leaving."
            : undefined
      }
      actions={onRetry ? [{ label: "Retry saving", onClick: onRetry }] : undefined}
    />
  );
}
