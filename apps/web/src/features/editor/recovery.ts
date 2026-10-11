/** @file recovery.ts @description Stores browser drafts and bounded local history in IndexedDB. @module editor */
import type { DevelopmentIdentity } from "@quorem/contracts";

/** Local source copy scoped to one owner, workspace, version, and language. */
export type RecoverySnapshot = {
  id?: number;
  scope: string;
  source: string;
  savedAt: string;
};

const databaseName = "quorem-editor-recovery-v1";
const storeName = "snapshots";

/** Opens the versioned recovery database. */
function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(storeName, {
        keyPath: "id",
        autoIncrement: true,
      });
      store.createIndex("scope", "scope");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is unavailable"));
  });
}

/** Creates the isolation key used by browser recovery history. */
export function scopeKey(
  identity: DevelopmentIdentity,
  workspaceId: string,
  problemVersionId: string,
) {
  return `${identity}:${workspaceId}:${problemVersionId}:python`;
}

/** Stable practice scope; match workspaces keep separate private drafts. */
export function browserDraftScope(workspace: { id: string; kind: string }) {
  return workspace.kind === "solo" ? "solo" : workspace.id;
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

export async function readBrowserHistory(
  identity: DevelopmentIdentity,
  workspaceId: string,
  version: string,
) {
  const db = await openDatabase();
  try {
    return await listScope(db, scopeKey(identity, workspaceId, version));
  } finally {
    db.close();
  }
}

/** Appends a recovery snapshot and trims expired or excess copies. */
export async function writeRecovery(
  identity: DevelopmentIdentity,
  workspaceId: string,
  problemVersionId: string,
  source: string,
) {
  const db = await openDatabase();
  const scope = scopeKey(identity, workspaceId, problemVersionId);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).add({ scope, source, savedAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save local recovery"));
    tx.onabort = () => reject(tx.error ?? new Error("Local recovery was interrupted"));
  });

  const snapshots = await listScope(db, scope);
  const expiredIds = snapshots
    .filter((snapshot) => Date.now() - Date.parse(snapshot.savedAt) > 30 * 24 * 60 * 60 * 1000)
    .map(({ id }) => id)
    .filter((id): id is number => id !== undefined);
  const overflowIds = snapshots
    .slice(100)
    .map(({ id }) => id)
    .filter((id): id is number => id !== undefined);
  const removals = new Set([...expiredIds, ...overflowIds]);
  if (removals.size > 0) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      for (const id of removals) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not trim local recovery"));
    });
  }
  db.close();
}

/** Returns the newest local snapshot for an exact workspace scope. */
export async function readLatestRecovery(
  identity: DevelopmentIdentity,
  workspaceId: string,
  problemVersionId: string,
) {
  const db = await openDatabase();
  const snapshots = await listScope(db, scopeKey(identity, workspaceId, problemVersionId));
  db.close();
  return snapshots[0];
}

/** Removes all local source copies for the selected local identity. */
export async function clearOwnerRecovery(identity: DevelopmentIdentity) {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(`${latestPrefix}${identity}:`)) localStorage.removeItem(key);
  }
  const db = await openDatabase();
  const all = await new Promise<RecoverySnapshot[]>((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as RecoverySnapshot[]);
    request.onerror = () => reject(request.error ?? new Error("Could not read local recovery"));
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const snapshot of all) {
      if (snapshot.scope.startsWith(`${identity}:`)) store.delete(snapshot.id!);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not clear local recovery"));
  });
  db.close();
}

/** Reads a scope's snapshots in newest-first order. */
function listScope(db: IDBDatabase, scope: string) {
  return new Promise<RecoverySnapshot[]>((resolve, reject) => {
    const index = db.transaction(storeName).objectStore(storeName).index("scope");
    const request = index.getAll(scope);
    request.onsuccess = () => {
      const values = request.result as RecoverySnapshot[];
      values.sort(
        (left, right) =>
          right.savedAt.localeCompare(left.savedAt) || (right.id ?? 0) - (left.id ?? 0),
      );
      resolve(values);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not read local recovery"));
  });
}

/** Imports missing latest drafts from a private legacy export, never replacing local edits. */
export async function importBrowserDrafts(contents: string, identity: DevelopmentIdentity) {
  if (contents.length > 16 * 1024 * 1024) throw new Error("Draft export is too large.");
  const data: unknown = JSON.parse(contents);
  if (
    !data ||
    typeof data !== "object" ||
    !("workspaces" in data) ||
    !Array.isArray(data.workspaces)
  ) {
    throw new Error("Invalid draft export.");
  }
  let imported = 0;
  for (const item of data.workspaces) {
    if (!item || item.identity !== identity) continue;
    if (
      typeof item.workspaceId !== "string" ||
      typeof item.problemVersionId !== "string" ||
      typeof item.source !== "string" ||
      item.source.length > 65536 ||
      (item.kind !== "solo" && item.kind !== "match")
    )
      throw new Error("Invalid draft export entry.");
    const scope = browserDraftScope({ id: item.workspaceId, kind: item.kind });
    if (readBrowserDraft(identity, scope, item.problemVersionId) !== undefined) continue;
    writeBrowserDraft(identity, scope, item.problemVersionId, item.source);
    await writeRecovery(identity, scope, item.problemVersionId, item.source);
    imported++;
  }
  return imported;
}
