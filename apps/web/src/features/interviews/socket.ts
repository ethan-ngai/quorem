import { randomUUID } from "../../randomUUID";
/** Authorized bidirectional transport; reconnect recovery uses document versions and retry keys. */
import { createReconnectingSocket } from "../realtime/reconnectingSocket";
import { InterviewError } from "./api";

export function createInterviewSocket(id: string) {
  const changes = new Set<(kind?: string) => void>();
  const statuses = new Set<(connected: boolean) => void>();
  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  function rejectPending() {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Interview socket disconnected"));
    }
    pending.clear();
  }
  const connection = createReconnectingSocket({
    url: () => {
      const url = new URL(
        `/v1/interviews/${encodeURIComponent(id)}/events`,
        import.meta.env.VITE_API_BASE_URL ?? window.location.origin,
      );
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return url;
    },
    timeout: 10_000,
    onOpen() {
      for (const status of statuses) status(true);
      for (const change of changes) change();
    },
    onMessage(event) {
      try {
        const frame = JSON.parse(String(event.data)) as {
          type: string;
          kind?: string;
          id?: string;
          value?: unknown;
          error?: { code: string; status: number; message: string };
        };
        if (frame.type === "changed") {
          for (const change of changes) change(frame.kind);
          return;
        }
        if (frame.type !== "response" || !frame.id) return;
        const request = pending.get(frame.id);
        if (!request) return;
        pending.delete(frame.id);
        clearTimeout(request.timer);
        if (frame.error) request.reject(new InterviewError(frame.error.code, frame.error.status));
        else request.resolve(frame.value);
      } catch {
        connection.current?.close(1002, "Invalid interview frame");
      }
    },
    onDisconnect() {
      rejectPending();
      for (const status of statuses) status(false);
    },
  });
  return {
    start: connection.start,
    stop() {
      connection.stop();
      rejectPending();
    },
    onChange(listener: (kind?: string) => void) {
      changes.add(listener);
      return () => {
        changes.delete(listener);
      };
    },
    onStatus(listener: (connected: boolean) => void) {
      statuses.add(listener);
      return () => {
        statuses.delete(listener);
      };
    },
    request<T>(type: string, body: Record<string, unknown> = {}): Promise<T> {
      if (
        connection.current?.readyState !== WebSocket.OPEN ||
        connection.current.bufferedAmount > 512 * 1024 ||
        pending.size >= 64
      )
        return Promise.reject(new Error("Interview socket unavailable"));
      const key = randomUUID();
      return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          connection.current?.close();
        }, 10_000);
        pending.set(key, { resolve: (value) => resolve(value as T), reject, timer: timeout });
        try {
          connection.current!.send(JSON.stringify({ ...body, id: key, type }));
        } catch (cause) {
          pending.delete(key);
          clearTimeout(timeout);
          reject(cause);
        }
      });
    },
  };
}
export type InterviewSocket = ReturnType<typeof createInterviewSocket>;
