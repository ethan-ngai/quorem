/** @file Lifecycle adapter for the browser TypeScript compiler and CodeMirror extensions. */
import { typescriptLanguage } from "@codemirror/lang-javascript";
import {
  tsAutocompleteWorker,
  tsFacetWorker,
  tsHoverWorker,
  tsLinterWorker,
  tsSyncWorker,
} from "@valtown/codemirror-ts";
import type { WorkerShape } from "@valtown/codemirror-ts/worker";
import { releaseProxy, wrap } from "comlink";

/** Stop analysis when the document closes, changes language, or loses authentication. */
export async function browserTypeScriptIntelligence(signal: AbortSignal, onUnavailable = () => {}) {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./browserTypeScriptWorker.ts", import.meta.url), {
    type: "module",
  });
  const service = wrap<WorkerShape>(worker);
  let disposed = false;
  let rejectInitialization: (reason: unknown) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    rejectInitialization = reject;
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(deadline);
    signal.removeEventListener("abort", dispose);
    worker.removeEventListener("error", fail);
    worker.removeEventListener("messageerror", fail);
    void service[releaseProxy]();
    worker.terminate();
    rejectInitialization(new Error("TypeScript session closed"));
  }
  function fail() {
    dispose();
    onUnavailable();
  }
  const deadline = setTimeout(fail, 30000);
  signal.addEventListener("abort", dispose, { once: true });
  worker.addEventListener("error", fail);
  worker.addEventListener("messageerror", fail);
  try {
    await Promise.race([service.initialize(), interrupted]);
    clearTimeout(deadline);
    signal.throwIfAborted();
    return {
      dispose,
      extensions: [
        tsFacetWorker.of({ worker: service, path: "/main.ts" }),
        tsSyncWorker(),
        // Use language data so the shared authentication gate controls completion.
        typescriptLanguage.data.of({ autocomplete: tsAutocompleteWorker() }),
        tsHoverWorker(),
        tsLinterWorker(),
      ],
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
