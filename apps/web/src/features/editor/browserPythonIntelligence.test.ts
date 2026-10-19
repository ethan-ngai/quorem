/** @file browserPythonIntelligence.test.ts @description Browser Worker boot, protocol and teardown boundaries. @module editor */
import { afterEach, expect, it, vi } from "vitest";
import { browserPythonIntelligence } from "./browserPythonIntelligence";

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  sent: Record<string, unknown>[] = [];
  terminated = false;
  constructor() {
    super();
    FakeWorker.instances.push(this);
    queueMicrotask(() => this.receive({ type: "serverLoaded" }));
  }
  receive(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  terminate() {
    this.terminated = true;
  }
  postMessage(message: Record<string, unknown>) {
    this.sent.push(message);
    if (message.type === "initServer")
      queueMicrotask(() => this.receive({ type: "serverInitialized" }));
    if (message.method === "initialize")
      queueMicrotask(() =>
        this.receive({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            capabilities: {
              completionProvider: { triggerCharacters: ["."] },
              hoverProvider: true,
              signatureHelpProvider: { triggerCharacters: ["("] },
              textDocumentSync: 2,
            },
          },
        }),
      );
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});

it("boots a local engine with only public declarations and terminates on document disposal", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const controller = new AbortController();
  const session = await browserPythonIntelligence(controller.signal);
  const worker = FakeWorker.instances[0];
  const boot = worker.sent.find((message) => message.type === "initServer")!;
  const files = boot.userFiles as Record<string, string>;
  expect(Object.keys(files).sort()).toEqual(["main.py", "pyrightconfig.json", "quorem_types.pyi"]);
  expect(files["quorem_types.pyi"]).toContain("class TreeNode");
  expect(JSON.parse(files["pyrightconfig.json"]).pythonVersion).toBe("3.12");
  expect(session.extensions.length).toBe(2);
  controller.abort();
  expect(worker.terminated).toBe(true);
  session.dispose();
});

it("does not allocate a worker for an already closed document", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const controller = new AbortController();
  controller.abort();
  await expect(browserPythonIntelligence(controller.signal)).rejects.toThrow("cancelled");
  expect(FakeWorker.instances).toHaveLength(0);
});

it("terminates a worker cancelled during boot", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const controller = new AbortController();
  const session = browserPythonIntelligence(controller.signal);
  controller.abort();
  await expect(session).rejects.toThrow();
  expect(FakeWorker.instances[0].terminated).toBe(true);
});

it("removes a failed engine and reports an outage without exposing its error", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const controller = new AbortController();
  const unavailable = vi.fn();
  await browserPythonIntelligence(controller.signal, unavailable);
  FakeWorker.instances[0].dispatchEvent(new Event("error"));
  expect(unavailable).toHaveBeenCalledOnce();
  expect(unavailable).toHaveBeenCalledWith();
  expect(FakeWorker.instances[0].terminated).toBe(true);
});
