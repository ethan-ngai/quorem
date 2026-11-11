/** @file worker.ts @description Runs Microsoft Pyright over a dedicated browser worker. @module editor */
// oxlint-disable-next-line typescript/triple-slash-reference -- Ambient module supplied by esbuild.
/// <reference path="./resources.d.ts" />
import { configure, fs, InMemory } from "@zenfs/core";
import { Zip } from "@zenfs/archives";
import { NoAccessHost } from "pyright-source/packages/pyright-internal/src/common/host";
import { ensureTomlModuleLoaded } from "pyright-source/packages/pyright-internal/src/common/tomlUtils";
import { PyrightServer } from "pyright-source/packages/pyright-internal/src/server";
import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createConnection,
} from "vscode-languageserver/browser";
import typeshed from "quorem-pyright-typeshed";

class BrowserPyright extends PyrightServer {
  protected override createHost() {
    return new NoAccessHost();
  }
}

/** Mount the bundled stubs and open the single virtual workspace. */
async function initialize(event: MessageEvent) {
  if (event.data.type !== "initServer") return;
  self.removeEventListener("message", initialize);
  try {
    await ensureTomlModuleLoaded();
    await configure({
      mounts: { "/typeshed-fallback": { backend: Zip, data: typeshed }, "/tmp": InMemory },
    });
    fs.mkdirSync("/typings", { recursive: true });
    const files: Record<string, string> = event.data.userFiles;
    for (const [name, contents] of Object.entries(files)) {
      fs.writeFileSync(`/typings/${name}`, contents, "utf8");
    }

    const connection = createConnection(
      new BrowserMessageReader(self),
      new BrowserMessageWriter(self),
    );
    new BrowserPyright(connection, 0);
    self.postMessage({ type: "serverInitialized" });
  } catch (error) {
    self.postMessage({ type: "serverFailed" });
    console.error("Pyright worker initialization failed", error);
  }
}

self.addEventListener("message", initialize);
self.postMessage({ type: "serverLoaded" });
