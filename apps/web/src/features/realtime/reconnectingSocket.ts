/** @file reconnectingSocket.ts @description Authenticated socket lifetime, retry and stale-callback fencing. @module realtime */
import { token, tokenExpiresAt } from "../auth/session";
import { createReconnectScheduler } from "./reconnectScheduler";

type SocketOptions = {
  url: () => string | URL;
  timeout: number;
  idleTimeout?: number;
  onConnecting?: () => void;
  onOpen: () => void;
  onMessage: (event: MessageEvent) => void;
  onDisconnect: () => void;
  onError?: (cause: unknown) => void;
};

/** Transport lifecycle only; each domain owns its frame validation and recovery protocol. */
export function createReconnectingSocket(options: SocketOptions) {
  let socket: WebSocket | undefined;
  let stopped = true;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  function clearTimers() {
    clearTimeout(timer);
    clearTimeout(idleTimer);
    clearTimeout(refreshTimer);
  }
  const reconnect = createReconnectScheduler(
    () => void connect(),
    (callback, delay) => setTimeout(callback, delay),
    (timer) => clearTimeout(timer),
  );
  async function connect() {
    if (stopped) return;
    const started = generation;
    options.onConnecting?.();
    const valid = () => !stopped && started === generation;
    try {
      const bearer = await token();
      const expires = bearer ? tokenExpiresAt() : undefined;
      if (!valid()) return;
      const current = new WebSocket(
        options.url(),
        bearer ? ["quorem", `bearer.${bearer}`] : ["quorem"],
      );
      socket = current;
      const owns = () => valid() && socket === current;
      // Browser close handshakes can stall on broken networks; detach before reconnecting.
      const disconnect = (immediate = false) => {
        if (!owns()) return;
        clearTimers();
        socket = undefined;
        options.onDisconnect();
        current.close();
        if (immediate) void connect();
        else reconnect.schedule();
      };
      const renewIdle = () => {
        clearTimeout(idleTimer);
        if (options.idleTimeout) idleTimer = setTimeout(() => disconnect(), options.idleTimeout);
      };
      timer = setTimeout(() => {
        disconnect();
      }, options.timeout);
      current.onopen = () => {
        if (!owns()) return;
        clearTimeout(timer);
        reconnect.reset();
        renewIdle();
        if (expires)
          refreshTimer = setTimeout(
            () => disconnect(true),
            Math.max(1000, expires - Date.now() - 30_000),
          );
        options.onOpen();
      };
      current.onmessage = (event) => {
        if (owns()) {
          renewIdle();
          options.onMessage(event);
        }
      };
      current.onerror = () => {
        if (!owns()) return;
        options.onError?.(new Error("Event connection failed"));
        disconnect();
      };
      current.onclose = () => disconnect();
    } catch (cause) {
      if (!valid()) return;
      options.onError?.(cause);
      options.onDisconnect();
      reconnect.schedule();
    }
  }
  return {
    start(this: void) {
      if (!stopped) return;
      stopped = false;
      generation++;
      void connect();
    },
    stop() {
      stopped = true;
      generation++;
      clearTimers();
      reconnect.stop();
      socket?.close();
      socket = undefined;
    },
    get current() {
      return socket;
    },
  };
}
