/** @file useIntelligence.ts @description Disposable Python language sessions. @module editor */
import {
  LSPClient,
  serverCompletion,
  hoverTooltips,
  signatureHelp,
  serverDiagnostics,
  type Transport,
} from "@codemirror/lsp-client";
import type { Extension } from "@codemirror/state";
import type { DevelopmentIdentity } from "@quorem/contracts";
import DOMPurify from "dompurify";
import { useEffect, useState, useCallback } from "react";

type IntelligenceStatus = "connecting" | "ready" | "unavailable" | "replaced";

/** Connect one isolated language session per active document. Editing stays available during outages. */
export function useIntelligence(
  identity: DevelopmentIdentity,
  documentKey: string,
  enabled = true,
) {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [status, setStatus] = useState<IntelligenceStatus>("connecting");
  const key = `${identity}:${documentKey}`;
  const [attempt, setAttempt] = useState({ key: "", nonce: 0 });
  const retry = useCallback(() => setAttempt((value) => ({ key, nonce: value.nonce + 1 })), [key]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let socket: WebSocket | undefined;
    let client: LSPClient | undefined;
    let takeover = attempt.key === key;
    setExtensions([]);

    function connect() {
      if (disposed) return;
      setStatus("connecting");
      const url = new URL(import.meta.env.VITE_LANGUAGE_URL ?? "ws://127.0.0.1:8081/lsp");
      url.searchParams.set("user", identity);
      if (takeover) url.searchParams.set("takeover", "1");
      takeover = false;
      const active = new WebSocket(url);
      socket = active;
      const listeners = new Set<(message: string) => void>();
      const transport: Transport = {
        send(message) {
          if (disposed) return;
          if (active.readyState !== WebSocket.OPEN)
            throw new Error("Language connection unavailable");
          const request = JSON.parse(message) as {
            method?: string;
            params?: Record<string, unknown>;
          };
          if (request.method === "initialize" && request.params) {
            request.params.workspaceFolders = [{ uri: "file:///workspace", name: "Quorem" }];
          }
          active.send(JSON.stringify(request));
        },
        subscribe: (handler) => {
          listeners.add(handler);
        },
        unsubscribe: (handler) => {
          listeners.delete(handler);
        },
      };
      const deadline = setTimeout(() => active.close(4000, "Connection timeout"), 15000);
      active.addEventListener("message", (event: MessageEvent<unknown>) => {
        if (typeof event.data === "string") for (const listener of listeners) listener(event.data);
      });
      active.addEventListener("open", () => {
        const language = new LSPClient({
          rootUri: "file:///workspace",
          timeout: 15000,
          sanitizeHTML: (html) => DOMPurify.sanitize(html),
          extensions: [
            { clientCapabilities: { workspace: { workspaceFolders: true } } },
            serverCompletion({ override: true }),
            hoverTooltips(),
            signatureHelp(),
            serverDiagnostics(),
          ],
        });
        client = language;
        language.connect(transport);
        void language.initializing
          .then(() => {
            clearTimeout(deadline);
            if (disposed || socket !== active) return;
            setExtensions([language.plugin("file:///workspace/main.py", "python")]);
            setStatus("ready");
          })
          .catch(() => {
            active.close(4000, "Initialization failed");
          });
      });
      active.addEventListener("close", (event) => {
        clearTimeout(deadline);
        listeners.clear();
        if (disposed || socket !== active) return;
        setExtensions([]);
        setStatus(event.code === 4009 ? "replaced" : "unavailable");
        // A replaced tab must not reconnect automatically and evict the newer editor.
        if (event.code !== 4009 && failures++ < 3)
          reconnect = setTimeout(connect, 1000 * 2 ** failures);
      });
    }
    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnect);
      client?.disconnect();
      socket?.close(1000, "Document closed");
    };
  }, [identity, documentKey, key, attempt, enabled]);

  return { extensions, status, retry };
}
