/** @file submissionStream.ts @description Reconnects authenticated judge SSE while a result is pending. @module editor */
import { readSubmissionEvents } from "@quorem/contracts/submission-events";
import { authenticatedFetch } from "../auth/session";
import { createReconnectScheduler } from "../realtime/reconnectScheduler";

export function submissionStream(id: string, onChange: () => void, onDisconnect: () => void) {
  let active: AbortController | undefined;
  let stopped = true;
  const reconnect = createReconnectScheduler(
    () => void connect(),
    (callback, delay) => setTimeout(callback, delay),
    (timer) => clearTimeout(timer),
  );
  async function connect() {
    if (stopped) return;
    const request = new AbortController();
    active = request;
    const owns = () => !stopped && active === request;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let retry = true;
    function expectActivity(timeout = 35000) {
      clearTimeout(deadline);
      deadline = setTimeout(() => request.abort(), timeout);
    }
    expectActivity(10000);
    try {
      const url = new URL(
        `/v1/submissions/${encodeURIComponent(id)}/events`,
        import.meta.env.VITE_API_BASE_URL ?? window.location.origin,
      );
      const response = await authenticatedFetch(url, {
        signal: request.signal,
        headers: { Accept: "text/event-stream" },
      });
      if (!owns()) {
        await response.body?.cancel();
        return;
      }
      if ([401, 403, 404].includes(response.status)) {
        await response.body?.cancel();
        retry = false;
        onChange();
        return;
      }
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get("content-type")?.startsWith("text/event-stream")
      ) {
        await response.body?.cancel();
        throw new Error("Submission stream unavailable");
      }
      await readSubmissionEvents(
        response.body,
        () => {
          if (!owns()) return;
          reconnect.reset();
          onChange();
        },
        () => expectActivity(),
      );
    } catch {
      // A lost stream reconnects and receives a fresh invalidation.
    } finally {
      clearTimeout(deadline);
      if (owns()) {
        active = undefined;
        request.abort();
        if (retry) {
          onDisconnect();
          reconnect.schedule();
        }
      }
    }
  }
  return {
    start() {
      if (!stopped) return;
      stopped = false;
      void connect();
    },
    stop() {
      stopped = true;
      reconnect.stop();
      active?.abort();
      active = undefined;
    },
  };
}
