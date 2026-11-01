/** @file recovery.ts @description Independent bounded runtime recovery tasks. @module runtime */
/** Attempt every capability before surfacing a redacted aggregate failure. */
export async function recoverAll(tasks: readonly (() => Promise<unknown>)[]): Promise<void> {
  const results = await Promise.allSettled(tasks.map((task) => Promise.resolve().then(task)));
  if (results.some((result) => result.status === "rejected"))
    throw new Error("Runtime recovery unavailable");
}
