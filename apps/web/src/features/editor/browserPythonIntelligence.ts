/** @file browserPythonIntelligence.ts @description Local Pyright Worker using CodeMirror's standard LSP client. @module editor */
import {
  hoverTooltips,
  signatureHelp,
  serverDiagnostics,
  type Transport,
} from "@codemirror/lsp-client";
import { pythonLanguage } from "@codemirror/lang-python";
import DOMPurify from "dompurify";
import workerURL from "monaco-pyright-lsp/dist/worker.js?url";
import publicTypes from "../../../../../internal/execution/public/quorem_types.py?raw";
import { PythonLanguageClient } from "./pythonLanguageClient";

const rootUri = "file:///typings";
const documentUri = `${rootUri}/main.py`;

/** Load only the upstream Worker asset; Monaco's editor/provider code is not imported. */
export async function browserPythonIntelligence(
  signal: AbortSignal,
  onUnavailable: () => void = () => {},
) {
  if (signal.aborted) throw new Error("Python session cancelled");
  const worker = new Worker(workerURL);
  const listeners = new Set<(message: string) => void>();
  let client: PythonLanguageClient | undefined;
  let failed: (() => void) | undefined;
  let clearBoot = () => {};
  const pending = new Map<string | number, string>();
  let disposed = false;
  const onError = () => {
    failed?.();
    dispose();
    onUnavailable();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    failed?.();
    clearBoot();
    for (const [id, method] of pending) {
      const reply = JSON.stringify({
        jsonrpc: "2.0",
        id,
        ...(method === "initialize"
          ? { error: { code: -32000, message: "Python browser engine unavailable" } }
          : { result: null }),
      });
      for (const listener of listeners) listener(reply);
    }
    pending.clear();
    worker.removeEventListener("error", onError);
    client?.disconnect();
    worker.terminate();
    signal.removeEventListener("abort", dispose);
  };
  signal.addEventListener("abort", dispose, { once: true });
  worker.addEventListener("error", onError);
  const ready = new Promise<void>((resolve, reject) => {
    failed = () => reject(new Error("Python browser engine unavailable"));
    const deadline = setTimeout(failed, 30000);
    const cancel = () => {
      clearTimeout(deadline);
      failed?.();
    };
    signal.addEventListener("abort", cancel, { once: true });
    clearBoot = () => {
      clearTimeout(deadline);
      signal.removeEventListener("abort", cancel);
    };

    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      const message = event.data as {
        type?: string;
        method?: string;
        id?: string | number;
        params?: { items?: { section?: string }[] };
      };
      if (message.type === "serverLoaded") {
        worker.postMessage({
          type: "initServer",
          userFiles: {
            "main.py": "",
            "quorem_types.pyi": publicTypes,
            "pyrightconfig.json": JSON.stringify({
              pythonVersion: "3.12",
              typeCheckingMode: "basic",
              include: ["main.py"],
            }),
          },
        });
      } else if (message.type === "serverInitialized") {
        clearBoot();
        failed = undefined;
        resolve();
      } else if (message.method === "workspace/configuration" && message.id !== undefined) {
        const analysis = {
          typeCheckingMode: "basic",
          diagnosticMode: "openFilesOnly",
          extraPaths: ["/typings"],
        };
        worker.postMessage({
          jsonrpc: "2.0",
          id: message.id,
          result:
            message.params?.items?.map((item) =>
              item.section === "python"
                ? { pythonVersion: "3.12", analysis }
                : item.section === "python.analysis"
                  ? analysis
                  : null,
            ) ?? [],
        });
      } else {
        if (message.id !== undefined && !message.method) pending.delete(message.id);
        for (const listener of listeners) listener(JSON.stringify(event.data));
      }
    });
  });
  try {
    await ready;
    if (signal.aborted) throw new Error("Python session cancelled");
    const transport: Transport = {
      send: (text) => {
        if (disposed) return;
        const message = JSON.parse(text) as { id?: string | number; method?: string };
        if (message.id !== undefined && message.method) pending.set(message.id, message.method);
        worker.postMessage(message);
      },
      subscribe: (handler) => {
        listeners.add(handler);
      },
      unsubscribe: (handler) => {
        listeners.delete(handler);
      },
    };
    client = new PythonLanguageClient({
      rootUri,
      timeout: 15000,
      sanitizeHTML: (html) => DOMPurify.sanitize(html),
      extensions: [hoverTooltips(), signatureHelp(), serverDiagnostics()],
    });
    client.connect(transport);
    await client.initializing;
    if (signal.aborted) throw new Error("Python session cancelled");
    return {
      dispose,
      extensions: [
        client.plugin(documentUri, "python"),
        pythonLanguage.data.of({ autocomplete: client.completionSource }),
      ],
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
