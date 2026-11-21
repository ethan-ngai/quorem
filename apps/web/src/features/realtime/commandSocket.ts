/** @file commandSocket.ts @description Browser RPC and change notifications over the shared room transport. @module realtime */
import { randomUUID } from "../../randomUUID";
import { createReconnectingSocket } from "./reconnectingSocket";

export function createCommandSocket(options: {
  path: string;
  label: string;
  error(code: string, status: number, message: string): Error;
}) {
  const { path, label } = options;
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
      request.reject(new Error(`${label} socket disconnected`));
    }
    pending.clear();
  }
  const connection = createReconnectingSocket({
    url: () => {
      const url = new URL(path, import.meta.env.VITE_API_BASE_URL ?? window.location.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return url;
    },
    timeout: 10_000,
    idleTimeout: 25_000,
    onOpen() {
      for (const status of statuses) status(true);
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
        if (frame.error)
          request.reject(options.error(frame.error.code, frame.error.status, frame.error.message));
        else request.resolve(frame.value);
      } catch {
        connection.current?.close(1002, "Invalid command socket frame");
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
        return Promise.reject(new Error(`${label} socket unavailable`));
      const key = randomUUID();
      return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(key);
          reject(new Error(`${label} request timed out`));
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
