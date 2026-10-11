/** @file languageTransport.ts @description Settles LSP requests across socket teardown. @module editor */
import type { Transport } from "@codemirror/lsp-client";

/** A socket transport whose disposal releases every outstanding request. */
export function languageTransport(socket: WebSocket): Transport & { dispose(): void } {
  const listeners = new Set<(message: string) => void>();
  const pending = new Map<number | string, string>();
  let disposed = false;

  function settle(id: number | string, method: string) {
    pending.delete(id);
    const message = JSON.stringify({
      jsonrpc: "2.0",
      id,
      ...(method === "initialize"
        ? { error: { code: -32000, message: "Language connection closed" } }
        : { result: null }),
    });
    for (const listener of listeners) listener(message);
  }

  function receive(event: MessageEvent<unknown>) {
    if (disposed || typeof event.data !== "string") return;
    let message: { id?: number | string; method?: string };
    try {
      const value: unknown = JSON.parse(event.data);
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      message = value as typeof message;
    } catch {
      return;
    }
    if (message.id !== undefined && !message.method) pending.delete(message.id);
    for (const listener of listeners) listener(event.data);
  }
  socket.addEventListener("message", receive);

  return {
    send(text) {
      const message = JSON.parse(text) as {
        id?: number | string;
        method?: string;
        params?: Record<string, unknown>;
      };
      if (message.method === "initialize" && message.params) {
        message.params.workspaceFolders = [{ uri: "file:///workspace", name: "Quorem" }];
      }
      const request = message.id !== undefined && message.method !== undefined;
      if (request) pending.set(message.id!, message.method!);
      // CodeMirror queues notifications in microtasks, including after plugin removal.
      if (disposed || socket.readyState !== 1) {
        if (request) settle(message.id!, message.method!);
        return;
      }
      try {
        socket.send(JSON.stringify(message));
      } catch {
        this.dispose();
        socket.close(4000, "Language connection unavailable");
      }
    },
    subscribe: (handler) => void listeners.add(handler),
    unsubscribe: (handler) => void listeners.delete(handler),
    dispose() {
      if (disposed) return;
      disposed = true;
      socket.removeEventListener("message", receive);
      for (const [id, method] of pending) settle(id, method);
    },
  };
}
