import { SessionDialog } from "../../ui/SessionDialog";
import { useEffect, useRef } from "react";

/** Shared host confirmation for dashboard and workspace lifecycle actions. */
export function InterviewLifecycleDialog({
  action,
  busy,
  onClose,
  onConfirm,
}: {
  action?: "end" | "delete";
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const deleting = action === "delete";
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Pending disables the focused action; refocus the follow-up prompt after completion.
    if (action && !busy) keep.current?.focus();
  }, [action, busy]);
  return (
    <SessionDialog
      open={!!action}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={deleting ? "Delete interview?" : "End interview?"}
      description={
        deleting
          ? "Remove this ended interview from your library. Members will lose access."
          : "Editing and execution will stop. Code and results remain available until you delete the interview."
      }
      pending={busy}
    >
      <footer className="competitive-dialog-actions">
        <button ref={keep} className="button button-secondary" disabled={busy} onClick={onClose}>
          {deleting ? "Keep interview" : "Keep interviewing"}
        </button>
        <button
          className="button button-secondary button-destructive-hover"
          disabled={busy}
          onClick={onConfirm}
        >
          {deleting ? "Delete interview" : "End interview"}
        </button>
      </footer>
    </SessionDialog>
  );
}
