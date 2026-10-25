/** Authorized bidirectional transport; reconnect recovery uses document versions and retry keys. */
import { token } from "../auth/session";
import { InterviewError } from "./api";

export function createInterviewSocket(id: string) {
  let socket: WebSocket | undefined;
  let disposed = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let generation = 0;
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
  async function connect() {
    if (disposed) return;
    const started = generation;
    const bearer = await token();
    if (disposed || started !== generation) return;
    const url = new URL(
      `/v1/interviews/${id}/events`,
      import.meta.env.VITE_API_BASE_URL ?? window.location.origin,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    let current: WebSocket;
    try {
      current = new WebSocket(url, bearer ? ["quorem", `bearer.${bearer}`] : ["quorem"]);
    } catch {
      for (const status of statuses) status(false);
      timer = setTimeout(() => void connect(), Math.min(15_000, 300 * 2 ** attempt++));
      return;
    }
    socket = current;
    timer = setTimeout(() => current.close(), 10_000);
    current.onopen = () => {
      if (disposed || started !== generation || socket !== current) return;
      clearTimeout(timer);
      attempt = 0;
      for (const status of statuses) status(true);
      for (const change of changes) change();
    };
    current.onmessage = (event) => {
      if (disposed || started !== generation || socket !== current) return;
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
          request.reject(
            new InterviewError(frame.error.code, frame.error.message, frame.error.status),
          );
        else request.resolve(frame.value);
      } catch {
        current.close(1002, "Invalid interview frame");
      }
    };
    current.onerror = () => current.close();
    current.onclose = () => {
      if (disposed || started !== generation || socket !== current) return;
      clearTimeout(timer);
      rejectPending();
      for (const status of statuses) status(false);
      timer = setTimeout(
        () => void connect(),
        Math.min(15_000, 300 * 2 ** attempt++) * (0.75 + Math.random() / 2),
      );
    };
  }
  return {
    start() {
      if (!disposed) return;
      disposed = false;
      generation++;
      void connect();
    },
    stop() {
      disposed = true;
      generation++;
      clearTimeout(timer);
      socket?.close();
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
        disposed ||
        socket?.readyState !== WebSocket.OPEN ||
        socket.bufferedAmount > 512 * 1024 ||
        pending.size >= 64
      )
        return Promise.reject(new Error("Interview socket unavailable"));
      const key = crypto.randomUUID();
      return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket?.close();
        }, 10_000);
        pending.set(key, { resolve: (value) => resolve(value as T), reject, timer: timeout });
        try {
          socket!.send(JSON.stringify({ ...body, id: key, type }));
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
