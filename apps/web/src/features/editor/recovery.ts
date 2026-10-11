/** @file recovery.ts @description Stores private browser recovery snapshots in IndexedDB. @module editor */
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
function scopeKey(identity: DevelopmentIdentity, workspaceId: string, problemVersionId: string) {
  return `${identity}:${workspaceId}:${problemVersionId}:python`;
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
      values.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
      resolve(values);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not read local recovery"));
  });
}
