/** @file submission-events.ts @description Reads submission invalidations from the SSE response. @module contracts */
export const submissionChangedEvent = "event: changed\ndata: {}\n\n";

/** @returns Once the stream closes or the caller cancels it. */
export async function readSubmissionEvents(
  body: ReadableStream<Uint8Array>,
  onChange: () => void | Promise<void>,
  onActivity: () => void = () => {},
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      onActivity();
      pending += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = pending.indexOf("\n\n")) >= 0) {
        const frame = pending.slice(0, end + 2);
        pending = pending.slice(end + 2);
        if (frame === submissionChangedEvent) await onChange();
      }
      if (pending.length > 1024) throw new Error("Invalid submission event");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
