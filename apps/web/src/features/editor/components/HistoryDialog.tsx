/** @file HistoryDialog.tsx @description Loads and restores browser draft revisions. @module editor */
import { Notifications, useErrorNotification } from "../../../ui/Notifications";
import { userFacingErrorMessage } from "../../../ui/errors";
import type { DevelopmentIdentity, Workspace } from "@quorem/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { SessionDialog } from "../../../ui/SessionDialog";
import { browserDraftScope, readBrowserHistory } from "../recovery";

function errorMessage(error: unknown) {
  return userFacingErrorMessage(error, "Could not load draft history.");
}

/** Offers explicit restoration from the workspace's retained browser history. */
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
    queryFn: () =>
      readBrowserHistory(identity, browserDraftScope(workspace), workspace.problemVersionId),
  });
  const [restoringRevision, setRestoringRevision] = useState<string>();
  const [restoreError, setRestoreError] = useState<string>();
  useErrorNotification(restoreError, "draft-history");
  return (
    <SessionDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Browser history"
      description="Restore a previously saved version of this workspace."
      descriptionHidden
      className="history-dialog"
      pending={!!restoringRevision}
    >
      {historyQuery.isPending ? <p className="dialog-state">Loading saved versions…</p> : null}
      {historyQuery.error ? (
        <p className="dialog-state result-error">{errorMessage(historyQuery.error)}</p>
      ) : null}

      <ol className="history-list">
        {historyQuery.data?.map((item) => (
          <li key={String(item.id)}>
            <div>
              <strong>Revision {String(item.id)}</strong>
              <time dateTime={item.savedAt}>{new Date(item.savedAt).toLocaleString()}</time>
              <pre>{item.source.slice(0, 220)}</pre>
            </div>
            <button
              type="button"
              className="button button-secondary"
              disabled={!!restoringRevision}
              onClick={async () => {
                setRestoringRevision(String(item.id));
                setRestoreError(undefined);
                try {
                  await onRestore(item.source, String(item.id));
                  onClose();
                } catch (cause) {
                  setRestoreError(errorMessage(cause));
                } finally {
                  setRestoringRevision(undefined);
                }
              }}
            >
              {restoringRevision === String(item.id) ? "Restoring…" : "Restore"}
            </button>
          </li>
        ))}
      </ol>
      {historyQuery.data?.length === 0 ? (
        <p className="dialog-state">No previous saves yet.</p>
      ) : null}
      <Notifications id="draft-history" />
    </SessionDialog>
  );
}
