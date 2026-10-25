/** @file remoteCursor.test.ts @description Cursor label lifetime across updates and hover. @module collaboration */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CURSOR_LABEL_DELAY, RemoteCursor } from "./remoteCursor";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("document", {
    createElement: () => ({
      dataset: {},
      style: { setProperty: vi.fn() },
      setAttribute: vi.fn(),
      append: vi.fn(),
    }),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("fades the first label without showing it again on subsequent cursor movements", () => {
  const state = { visibleUntil: Date.now() + CURSOR_LABEL_DELAY };
  const cursor = new RemoteCursor("Alice", "green", state);
  const first = cursor.toDOM();
  expect(first.dataset.labelVisible).toBe("true");
  vi.advanceTimersByTime(CURSOR_LABEL_DELAY);
  expect(first.dataset.labelVisible).toBe("false");
  cursor.destroy(first);
  const moved = cursor.toDOM();
  expect(moved.dataset.labelVisible).toBe("false");
  cursor.destroy(moved);
  expect(vi.getTimerCount()).toBe(0);
});
it("holds the name during hover, then waits the same delay after leaving", () => {
  const cursor = new RemoteCursor("Alice", "green", { visibleUntil: 0 });
  const dom = cursor.toDOM();
  dom.onpointerenter!(new Event("pointerenter") as PointerEvent);
  vi.advanceTimersByTime(CURSOR_LABEL_DELAY * 2);
  expect(dom.dataset.labelVisible).toBe("true");
  dom.onpointerleave!(new Event("pointerleave") as PointerEvent);
  vi.advanceTimersByTime(CURSOR_LABEL_DELAY - 1);
  expect(dom.dataset.labelVisible).toBe("true");
  vi.advanceTimersByTime(1);
  expect(dom.dataset.labelVisible).toBe("false");
  cursor.destroy(dom);
});
it("does not leave a hovered label stuck when its editor widget is replaced", () => {
  const state = { visibleUntil: 0 };
  const cursor = new RemoteCursor("Alice", "green", state);
  const dom = cursor.toDOM();
  dom.onpointerenter!(new Event("pointerenter") as PointerEvent);
  cursor.destroy(dom);
  expect(state.visibleUntil).toBe(Date.now() + CURSOR_LABEL_DELAY);
  expect(vi.getTimerCount()).toBe(0);
});
