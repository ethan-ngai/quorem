/** @file reconnectingSocket.ts @description Authenticated socket lifetime, retry and stale-callback fencing. @module realtime */
import { token } from "../auth/session";
import { createReconnectScheduler } from "./reconnectScheduler";

type SocketOptions = {
  url: () => string | URL;
  timeout: number;
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
      if (!valid()) return;
      const current = new WebSocket(
        options.url(),
        bearer ? ["quorem", `bearer.${bearer}`] : ["quorem"],
      );
      socket = current;
      const owns = () => valid() && socket === current;
      timer = setTimeout(() => {
        if (owns()) current.close();
      }, options.timeout);
      current.onopen = () => {
        if (!owns()) return;
        clearTimeout(timer);
        reconnect.reset();
        options.onOpen();
      };
      current.onmessage = (event) => {
        if (owns()) options.onMessage(event);
      };
      current.onerror = () => {
        if (!owns()) return;
        options.onError?.(new Error("Event connection failed"));
        current.close();
      };
      current.onclose = () => {
        if (!owns()) return;
        clearTimeout(timer);
        socket = undefined;
        options.onDisconnect();
        reconnect.schedule();
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
      clearTimeout(timer);
      reconnect.stop();
      socket?.close();
      socket = undefined;
    },
    get current() {
      return socket;
    },
  };
}
