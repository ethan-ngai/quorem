/** @file documentSync.test.ts @description Document lifecycle and transport-neutral error policy. @module collaboration */
import { afterEach, expect, it, vi } from "vitest";
import { EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import { createDocumentSync, type DocumentUpdates } from "./documentSync";

vi.mock("@codemirror/view", () => ({ ViewPlugin: { fromClass: (plugin: unknown) => plugin } }));
afterEach(() => vi.useRealTimers());

function client(pull: () => Promise<DocumentUpdates>) {
  vi.useFakeTimers();
  const onStatus = vi.fn();
  const onDestroy = vi.fn();
  const onSynchronized = vi.fn(async () => {});
  const sync = createDocumentSync({
    document: { epoch: "one", version: 0 },
    clientID: "local",
    pull,
    push: vi.fn(),
    classifyError: (error) => (error === "replaced" ? "replaced" : "offline"),
    onStatus,
    onDestroy,
    onSynchronized,
  });
  const [extension, Plugin] = sync.extension as unknown as [
    Extension,
    new (view: unknown) => { destroy: () => void },
  ];
  let state = EditorState.create({ doc: "local source", extensions: extension });
  const plugin = new Plugin({
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
  });
  return { sync, plugin, onStatus, onDestroy, onSynchronized };
}

it("rejects a replacement epoch before running synchronized policy", async () => {
  const local = client(async () => ({ epoch: "two", version: 0, updates: [] }));
  expect(await local.sync.flush()).toBe(false);
  expect(local.sync.isSynchronized()).toBe(false);
  expect(local.onSynchronized).not.toHaveBeenCalled();
  expect(local.onStatus).toHaveBeenLastCalledWith("replaced");
  local.plugin.destroy();
});

it("does not revive a destroyed document when an in-flight read finishes", async () => {
  let complete!: (updates: DocumentUpdates) => void;
  const local = client(() => new Promise((resolve) => (complete = resolve)));
  const pending = local.sync.flush();
  local.plugin.destroy();
  complete({ epoch: "one", version: 0, updates: [] });
  expect(await pending).toBe(false);
  expect(local.onDestroy).toHaveBeenCalledOnce();
  expect(local.onSynchronized).not.toHaveBeenCalled();
  expect(local.onStatus).toHaveBeenLastCalledWith("connecting");
});

it("accepts replacement classification without interview errors", async () => {
  const local = client(() => Promise.reject("replaced"));
  expect(await local.sync.flush()).toBe(false);
  expect(local.onStatus).toHaveBeenLastCalledWith("replaced");
  local.plugin.destroy();
});

it("sends a bounded batch while edits keep arriving faster than the batching interval", async () => {
  vi.useFakeTimers();
  const push = vi.fn(async (body) => ({ ...body, version: body.updates.length }));
  const sync = createDocumentSync({
    document: { epoch: "one", version: 0 },
    clientID: "local",
    pull: async () => ({ epoch: "one", version: 0, updates: [] }),
    push,
    classifyError: () => "offline",
    onStatus: vi.fn(),
  });
  const [extension, Plugin] = sync.extension as unknown as [
    Extension,
    new (view: unknown) => {
      update: (change: { docChanged: boolean }) => void;
      destroy: () => void;
    },
  ];
  let state = EditorState.create({ extensions: extension });
  const plugin = new Plugin({
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
  });
  for (let i = 0; i < 4; i++) {
    state = state.update({ changes: { from: state.doc.length, insert: "x" } }).state;
    plugin.update({ docChanged: true });
    await vi.advanceTimersByTimeAsync(10);
  }
  expect(push).toHaveBeenCalledOnce();
  expect(push.mock.calls[0]![0].updates).toHaveLength(4);
  plugin.destroy();
});

it("retries a transient synchronization failure without requiring another room event", async () => {
  vi.useFakeTimers();
  const pull = vi
    .fn()
    .mockRejectedValueOnce(new Error("temporary failure"))
    .mockResolvedValue({ epoch: "one", version: 0, updates: [] });
  const onStatus = vi.fn();
  const sync = createDocumentSync({
    document: { epoch: "one", version: 0 },
    clientID: "local",
    pull,
    push: vi.fn(),
    classifyError: () => "retry",
    onStatus,
  });
  const [extension, Plugin] = sync.extension as unknown as [
    Extension,
    new (view: unknown) => { destroy: () => void },
  ];
  const state = EditorState.create({ extensions: extension });
  const plugin = new Plugin({ state, dispatch: vi.fn() });
  expect(await sync.flush()).toBe(false);
  expect(onStatus).toHaveBeenLastCalledWith("offline");
  await vi.advanceTimersByTimeAsync(1000);
  expect(pull).toHaveBeenCalledTimes(2);
  expect(onStatus).toHaveBeenLastCalledWith("connected");
  plugin.destroy();
});

it("does not mark a disconnected socket connected when an earlier read finishes", async () => {
  let complete!: (updates: DocumentUpdates) => void;
  const local = client(() => new Promise((resolve) => (complete = resolve)));
  const pending = local.sync.flush();
  local.sync.connectionChanged(false);
  complete({ epoch: "one", version: 0, updates: [] });
  await pending;
  expect(local.onStatus).toHaveBeenLastCalledWith("offline");
  local.plugin.destroy();
});
