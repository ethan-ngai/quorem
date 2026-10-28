/** @file pendingExecution.ts @description Retry keys for uncertain execution admissions. @module execution */
import { randomUUID } from "../../randomUUID";

export type PendingExecution = { fingerprint: string; key: string };

/** @returns The existing key for this command or a new persisted key. */
export function pendingExecution(
  storageKey: string,
  fingerprint: string,
  current?: PendingExecution,
): PendingExecution {
  try {
    const recovered: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (
      recovered &&
      typeof recovered === "object" &&
      "fingerprint" in recovered &&
      recovered.fingerprint === fingerprint &&
      "key" in recovered &&
      typeof recovered.key === "string" &&
      recovered.key.length > 0 &&
      recovered.key.length <= 128
    )
      current = { fingerprint, key: recovered.key };
  } catch {
    /* The current tab retains its key when storage is unavailable. */
  }
  const pending =
    current?.fingerprint === fingerprint ? current : { fingerprint, key: randomUUID() };
  try {
    localStorage.setItem(storageKey, JSON.stringify(pending));
  } catch {
    /* Execution remains available without browser storage. */
  }
  return pending;
}

/** Remove only this admission's key; another tab may have replaced it. */
export function clearPendingExecution(storageKey: string, key: string) {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (stored && typeof stored === "object" && "key" in stored && stored.key === key)
      localStorage.removeItem(storageKey);
  } catch {
    /* Storage is optional. */
  }
}
