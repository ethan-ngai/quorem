/** @file pendingExecution.test.ts @description Recovery keys survive uncertain admission responses. @module execution */
import { afterEach, expect, it, vi } from "vitest";
import { clearPendingExecution, pendingExecution } from "./pendingExecution";

function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}

afterEach(() => vi.unstubAllGlobals());

it("recovers the same admission after reload and replaces it when the command changes", () => {
  const values = storage();
  const first = pendingExecution("pending", "source-and-cases");
  expect(pendingExecution("pending", "source-and-cases")).toEqual(first);
  const next = pendingExecution("pending", "changed-source", first);
  expect(next.key).not.toBe(first.key);
  clearPendingExecution("pending", first.key);
  expect(JSON.parse(values.get("pending")!)).toEqual(next);
  clearPendingExecution("pending", next.key);
  expect(values.has("pending")).toBe(false);
});

it("keeps an in-memory retry key when browser storage is unavailable", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("disabled");
    },
    setItem: () => {
      throw new Error("disabled");
    },
    removeItem: () => {
      throw new Error("disabled");
    },
  });
  const first = pendingExecution("pending", "same");
  expect(pendingExecution("pending", "same", first)).toEqual(first);
  expect(() => clearPendingExecution("pending", first.key)).not.toThrow();
});

it("does not reuse malformed stored keys", () => {
  const values = storage();
  values.set("pending", JSON.stringify({ fingerprint: "same", key: "" }));
  expect(pendingExecution("pending", "same").key).not.toBe("");
});
