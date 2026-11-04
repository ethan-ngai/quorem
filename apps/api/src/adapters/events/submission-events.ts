/** @file submission-events.ts @description Bounded SSE invalidations for authorized submissions. @module judging */
import { submissionChangedEvent } from "@quorem/contracts/submission-events";
import type { FanoutSubscriber } from "./fanout/publisher.ts";

export function submissionEventId(path: string): string | undefined {
  return /^\/v1\/submissions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/events$/i
    .exec(path)?.[1]
    .toLowerCase();
}

/** Subscribe before the first invalidation so a reconnect repairs any missed notices. */
export async function submissionEvents(
  request: Request,
  id: string,
  notices: FanoutSubscriber,
  reauthorize: () => Promise<void>,
) {
  const lifetime = new AbortController();
  const encoder = new TextEncoder();
  let output: ReadableStreamDefaultController<Uint8Array> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let verifying = false;
  let dirty = false;
  let unsubscribe: (() => void) | undefined;
  function close() {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    clearInterval(heartbeat);
    request.signal.removeEventListener("abort", close);
    unsubscribe?.();
    output?.close();
    output = undefined;
  }
  function send(frame: string) {
    if (!output) return;
    if ((output.desiredSize ?? 0) <= 0) close();
    else output.enqueue(encoder.encode(frame));
  }
  async function flush() {
    if (!output || verifying) return;
    verifying = true;
    try {
      do {
        const changed = dirty;
        dirty = false;
        await reauthorize();
        send(changed ? submissionChangedEvent : ": heartbeat\n\n");
      } while (output && dirty);
    } catch {
      close();
    } finally {
      verifying = false;
    }
  }
  function notice() {
    dirty = true;
    void flush();
  }
  request.signal.addEventListener("abort", close, { once: true });
  if (request.signal.aborted) close();
  try {
    unsubscribe = await notices.subscribe(`/submissions/${id}`, notice, close, lifetime.signal);
    if (lifetime.signal.aborted) unsubscribe();
  } catch (error) {
    close();
    throw error;
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (lifetime.signal.aborted) {
        controller.close();
        return;
      }
      output = controller;
      dirty = false;
      send(submissionChangedEvent);
      heartbeat = setInterval(() => void flush(), 15000);
    },
    cancel() {
      output = undefined;
      close();
    },
  });
}
