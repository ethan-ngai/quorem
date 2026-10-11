/** @file useIntelligence.ts @description Disposable Python language sessions. @module editor */
import { hoverTooltips, signatureHelp, serverDiagnostics } from "@codemirror/lsp-client";
import { pythonLanguage } from "@codemirror/lang-python";
import type { Extension } from "@codemirror/state";
import type { DevelopmentIdentity } from "@quorem/contracts";
import DOMPurify from "dompurify";
import { useEffect, useState, useCallback } from "react";
import { watchEditorActivity } from "./languageActivity";
import { languageTransport } from "./languageTransport";
import { PythonLanguageClient } from "./pythonLanguageClient";

type IntelligenceStatus = "connecting" | "ready" | "unavailable" | "paused";

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
    if (!enabled) {
      setExtensions([]);
      return;
    }
    let disposed = false;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let socket: WebSocket | undefined;
    let client: PythonLanguageClient | undefined;
    let transport: ReturnType<typeof languageTransport> | undefined;
    setExtensions([]);

    const isActive = () => document.visibilityState === "visible" && document.hasFocus();

    function pause() {
      clearTimeout(reconnect);
      socket = undefined;
      transport?.dispose();
      client?.disconnect();
      transport = undefined;
      client = undefined;
      setExtensions([]);
      setStatus("paused");
    }

    function connect() {
      if (disposed || !isActive() || socket) return;
      setStatus("connecting");
      const url = new URL(import.meta.env.VITE_LANGUAGE_URL ?? "ws://127.0.0.1:8081/lsp");
      url.searchParams.set("user", identity);
      url.searchParams.set("takeover", "1");
      const active = new WebSocket(url);
      socket = active;
      const connection = languageTransport(active);
      transport = connection;
      let language: PythonLanguageClient | undefined;
      const deadline = setTimeout(() => active.close(4000, "Connection timeout"), 15000);
      active.addEventListener("open", () => {
        if (disposed || socket !== active) return;
        language = new PythonLanguageClient(
          {
            rootUri: "file:///workspace",
            timeout: 15000,
            sanitizeHTML: (html) => DOMPurify.sanitize(html),
            extensions: [
              { clientCapabilities: { workspace: { workspaceFolders: true } } },
              hoverTooltips(),
              signatureHelp(),
              serverDiagnostics(),
            ],
          },
          () => active.close(4000, "Language requests timed out"),
        );
        client = language;
        language.connect(connection);
        void language.initializing
          .then(() => {
            clearTimeout(deadline);
            if (disposed || socket !== active || active.readyState !== WebSocket.OPEN) return;
            failures = 0;
            setExtensions([
              language!.plugin("file:///workspace/main.py", "python"),
              // Preserve local completion state while the language service initializes/reconnects.
              pythonLanguage.data.of({ autocomplete: language!.completionSource }),
            ]);
            setStatus("ready");
          })
          .catch(() => {
            active.close(4000, "Initialization failed");
          });
      });
      active.addEventListener("close", (event) => {
        clearTimeout(deadline);
        connection.dispose();
        language?.disconnect();
        if (disposed || socket !== active) return;
        socket = undefined;
        setExtensions([]);
        setStatus(event.code === 4009 || !isActive() ? "paused" : "unavailable");
        // Replaced windows wait for a real focus event instead of reclaiming the engine.
        if (event.code !== 4009 && isActive() && failures++ < 3)
          reconnect = setTimeout(connect, 1000 * 2 ** failures);
      });
    }
    const stopWatching = watchEditorActivity(
      () => {
        failures = 0;
        connect();
      },
      () => {
        const active = socket;
        pause();
        active?.close(1000, "Editor paused");
      },
    );
    return () => {
      disposed = true;
      stopWatching();
      clearTimeout(reconnect);
      transport?.dispose();
      client?.disconnect();
      socket?.close(1000, "Document closed");
    };
  }, [identity, documentKey, key, attempt, enabled]);

  return { extensions, status, retry };
}
