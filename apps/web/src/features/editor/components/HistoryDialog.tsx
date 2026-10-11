/** @file HistoryDialog.tsx @description Loads and restores server-backed draft revisions. @module editor */
import type { DevelopmentIdentity, Workspace } from "@quorem/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fetchDraftHistory } from "../api";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not load draft history.";
}

/** Offers explicit restoration from the workspace's retained server history. */
export function HistoryDialog({
  identity,
  workspace,
  onClose,
  onRestore,
}: {
  identity: DevelopmentIdentity;
  workspace: Workspace;
  onClose: () => void;
  onRestore: (source: string, revision: string) => Promise<void>;
}) {
  const historyQuery = useQuery({
    queryKey: ["draft-history", identity, workspace.id],
    queryFn: () => fetchDraftHistory(identity, workspace.id),
  });
  const [restoringRevision, setRestoringRevision] = useState<string>();
  const [restoreError, setRestoreError] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <div
      className="dialog-scrim"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <dialog
        ref={dialog}
        className="history-dialog"
        aria-labelledby="history-title"
        onCancel={onClose}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">Workspace</span>
            <h2 id="history-title">Draft history</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close draft history"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {historyQuery.isPending ? <p className="dialog-state">Loading saved versions…</p> : null}
        {historyQuery.error ? (
          <p className="dialog-state result-error">{errorMessage(historyQuery.error)}</p>
        ) : null}
        {restoreError && (
          <p className="dialog-state result-error" role="alert">
            {restoreError}
          </p>
        )}
        <ol className="history-list">
          {historyQuery.data?.items.map((item) => (
            <li key={item.revision}>
              <div>
                <strong>Revision {item.revision}</strong>
                <time dateTime={item.savedAt}>{new Date(item.savedAt).toLocaleString()}</time>
                <pre>{item.source.slice(0, 220)}</pre>
              </div>
              <button
                type="button"
                className="button button-secondary"
                disabled={!!restoringRevision}
                onClick={async () => {
                  setRestoringRevision(item.revision);
                  setRestoreError(undefined);
                  try {
                    await onRestore(item.source, item.revision);
                    onClose();
                  } catch (cause) {
                    setRestoreError(errorMessage(cause));
                  } finally {
                    setRestoringRevision(undefined);
                  }
                }}
              >
                {restoringRevision === item.revision ? "Restoring…" : "Restore"}
              </button>
            </li>
          ))}
        </ol>
        {historyQuery.data?.items.length === 0 ? (
          <p className="dialog-state">No previous saves yet.</p>
        ) : null}
      </dialog>
    </div>
  );
}
