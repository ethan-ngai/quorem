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
