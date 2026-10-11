/** @file cleanup.ts @description Serialized, retryable language container teardown. @module language */

/** Retain successful teardown; retry failures without overlapping cleanup operations. */
export function retryableCleanup(operation: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () => {
    pending ??= Promise.resolve()
      .then(operation)
      .catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
    return pending;
  };
}
