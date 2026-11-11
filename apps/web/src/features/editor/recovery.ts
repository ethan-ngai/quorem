/** @file recovery.ts @description Stores the latest browser autosave. @module editor */
import type { DevelopmentIdentity } from "@quorem/contracts";

/** Local source copy scoped to one owner, workspace, version, and language. */
type RecoverySnapshot = {
  id?: number;
  scope: string;
  source: string;
  savedAt: string;
};

const databaseName = "quorem-editor-recovery-v1";
const storeName = "snapshots";

/** Opens the previous recovery store only if it exists. */
function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is unavailable"));
  });
}

/** Keys autosaves by owner, workspace and question version. */
function scopeKey(identity: DevelopmentIdentity, workspaceId: string, problemVersionId: string) {
  // Retain the legacy suffix; non-Python languages live in the workspace scope.
  return `${identity}:${workspaceId}:${problemVersionId}:python`;
}

/** Stable practice scope; match workspaces keep separate private drafts. */
export function browserDraftScope(workspace: { id: string; kind: string; language?: string }) {
  if (workspace.kind !== "solo") return workspace.id;
  return workspace.language && workspace.language !== "python"
    ? `solo:${workspace.language}`
    : "solo";
}

const latestPrefix = "quorem.browser-draft.v1:";

/** Synchronous latest copy survives immediate reloads and page closure. */
export function readBrowserDraft(
  identity: DevelopmentIdentity,
  workspaceId: string,
  version: string,
) {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(latestPrefix + scopeKey(identity, workspaceId, version)) ?? "null",
    );
    if (
      value &&
      typeof value === "object" &&
      "source" in value &&
      typeof value.source === "string"
    ) {
      return value.source;
    }
  } catch {
    /* IndexedDB history can recover when browser storage is unavailable. */
  }
  return undefined;
}

export function writeBrowserDraft(
  identity: DevelopmentIdentity,
  workspaceId: string,
  version: string,
  source: string,
) {
  localStorage.setItem(
    latestPrefix + scopeKey(identity, workspaceId, version),
    JSON.stringify({ source }),
  );
}

/** Recovers the latest older autosave for workspaces without a current copy. */
export async function readLatestRecovery(
  identity: DevelopmentIdentity,
  workspaceId: string,
  version: string,
) {
  const db = await openDatabase();
  try {
    return await new Promise<RecoverySnapshot | undefined>((resolve, reject) => {
      const index = db.transaction(storeName).objectStore(storeName).index("scope");
      const request = index.getAll(scopeKey(identity, workspaceId, version));
      request.onsuccess = () => {
        const snapshots = request.result as RecoverySnapshot[];
        snapshots.sort(
          (left, right) =>
            right.savedAt.localeCompare(left.savedAt) || (right.id ?? 0) - (left.id ?? 0),
        );
        resolve(snapshots[0]);
      };
      request.onerror = () => reject(request.error ?? new Error("Could not read local recovery"));
    });
  } finally {
    db.close();
  }
}

export type PendingBrowserDraft = {
  identity: DevelopmentIdentity;
  workspaceId: string;
  version: string;
  source: string;
};

/** Coalesces typing writes after paint; lifecycle boundaries flush synchronously. */
export function createBrowserDraftWriter(
  onError: (error: unknown, draft: PendingBrowserDraft) => void,
) {
  let pending: PendingBrowserDraft | undefined;
  let frame: number | undefined;
  let task: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (task !== undefined) clearTimeout(task);
    frame = undefined;
    task = undefined;
    if (!pending) return;
    const draft = pending;
    writeBrowserDraft(draft.identity, draft.workspaceId, draft.version, draft.source);
    pending = undefined;
  };
  return {
    schedule(draft: PendingBrowserDraft) {
      pending = draft;
      if (frame !== undefined || task !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        // A frame callback precedes paint; a following task lets the cursor paint first.
        task = setTimeout(() => {
          task = undefined;
          const draft = pending;
          try {
            flush();
          } catch (error) {
            if (draft) onError(error, draft);
          }
        }, 0);
      });
    },
    flush,
  };
}
