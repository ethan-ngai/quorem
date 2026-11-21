/** @file reconnectingSocket.ts @description Authenticated socket lifetime, retry and stale-callback fencing. @module realtime */
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
  onComplete?: () => void;
};

/** Transport lifecycle only; each domain owns its frame validation and recovery protocol. */
export function createReconnectingSocket(options: SocketOptions) {
  let socket: WebSocket | undefined;
  let stopped = true;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  function clearTimers() {
    clearTimeout(timer);
    clearTimeout(idleTimer);
    clearInterval(pingTimer);
  }
  const reconnect = createReconnectScheduler(
    () => void connect(),
    (callback, delay) => setTimeout(callback, delay),
    (timer) => clearTimeout(timer),
  );
  function connect() {
    if (stopped) return;
    const started = generation;
    options.onConnecting?.();
    const valid = () => !stopped && started === generation;
    try {
      const current = new WebSocket(options.url(), ["quorem-hibernate"]);
      socket = current;
      const owns = () => valid() && socket === current;
      // Browser close handshakes can stall on broken networks; detach before reconnecting.
      const detach = () => {
        if (!owns()) return;
        clearTimers();
        socket = undefined;
        current.close();
        return true;
      };
      const disconnect = () => {
        if (!detach()) return;
        options.onDisconnect();
        reconnect.schedule();
      };
      const renewIdle = () => {
        clearTimeout(idleTimer);
        if (options.idleTimeout)
          idleTimer = setTimeout(() => {
            if (globalThis.document?.hidden) renewIdle();
            else disconnect();
          }, options.idleTimeout);
      };
      timer = setTimeout(() => {
        disconnect();
      }, options.timeout);
      current.onopen = () => {
        if (!owns()) return;
        clearTimeout(timer);
        reconnect.reset();
        renewIdle();
        if (current.protocol !== "quorem-hibernate") {
          disconnect();
          return;
        }
        const ping = () => {
          if (owns() && current.readyState === WebSocket.OPEN) current.send("quorem:ping");
        };
        ping();
        pingTimer = setInterval(ping, 10_000);
        options.onOpen();
      };
      current.onmessage = (event) => {
        if (owns()) {
          renewIdle();
          if (event.data === "quorem:pong") return;
          try {
            if (typeof event.data !== "string") throw new Error("Invalid socket frame");
            const frame: unknown = JSON.parse(event.data);
            if (!frame || typeof frame !== "object" || Array.isArray(frame))
              throw new Error("Invalid socket frame");
            const envelope = frame as { receipt?: unknown; payload?: unknown };
            if (
              typeof envelope.receipt !== "string" ||
              !/^[0-9a-f-]{36}$/i.test(envelope.receipt) ||
              !("payload" in envelope)
            )
              throw new Error("Invalid socket receipt");
            current.send(JSON.stringify({ type: "receipt", id: envelope.receipt }));
            options.onMessage(
              new MessageEvent("message", { data: JSON.stringify(envelope.payload) }),
            );
          } catch {
            current.close(1002, "Invalid socket frame");
          }
        }
      };
      current.onerror = () => {
        if (!owns()) return;
        options.onError?.(new Error("Event connection failed"));
        disconnect();
      };
      current.onclose = (event) => {
        if (options.onComplete && event.code === 1000 && event.reason === "Complete") {
          if (detach()) options.onComplete();
          return;
        }
        disconnect();
      };
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
