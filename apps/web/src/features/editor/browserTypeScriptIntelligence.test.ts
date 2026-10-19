/** @file Worker lifecycle must follow the document and authentication lifetime. */
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ initialize: vi.fn(), release: vi.fn() }));
vi.mock("comlink", () => ({
  releaseProxy: "release",
  wrap: () => ({ initialize: mocks.initialize, release: mocks.release }),
}));
import { browserTypeScriptIntelligence } from "./browserTypeScriptIntelligence";

class TestWorker extends EventTarget {
  static instances: TestWorker[] = [];
  terminate = vi.fn();
  constructor() {
    super();
    TestWorker.instances.push(this);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  TestWorker.instances = [];
});

describe("TypeScript worker lifetime", () => {
  it("does not allocate a worker for an aborted session", async () => {
    vi.stubGlobal("Worker", TestWorker);
    const controller = new AbortController();
    controller.abort();
    await expect(browserTypeScriptIntelligence(controller.signal)).rejects.toThrow();
    expect(TestWorker.instances).toHaveLength(0);
  });

  it("terminates an initializing worker on document change", async () => {
    vi.stubGlobal("Worker", TestWorker);
    mocks.initialize.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const pending = browserTypeScriptIntelligence(controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("session closed");
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it("reports crashes and cleans up a ready worker exactly once", async () => {
    vi.stubGlobal("Worker", TestWorker);
    mocks.initialize.mockResolvedValue(undefined);
    const unavailable = vi.fn();
    const session = await browserTypeScriptIntelligence(new AbortController().signal, unavailable);
    TestWorker.instances[0].dispatchEvent(new Event("error"));
    session.dispose();
    expect(unavailable).toHaveBeenCalledOnce();
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
