// @vitest-environment happy-dom
/** @file useSwipeToDelete.test.tsx @description Native scroll progress and completion for trackpad swipes. @module notifications */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSwipeToDelete } from "./useSwipeToDelete";

const onDelete = vi.fn(async () => {});
let row: HTMLDivElement;
let scroll: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;

function Subject() {
  const swipe = useSwipeToDelete(false, onDelete);
  return (
    <div {...swipe.scroll}>
      <div {...swipe.row} />
    </div>
  );
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onDelete.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Subject />));
  scroll = host.firstElementChild as HTMLDivElement;
  row = scroll.firstElementChild as HTMLDivElement;
  Object.defineProperties(scroll, { clientWidth: { value: 300 }, scrollWidth: { value: 450 } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function move(left: number) {
  scroll.scrollLeft = left;
  scroll.dispatchEvent(new Event("scroll"));
}

const fill = () => row.style.getPropertyValue("--notification-swipe-progress");

it("holds progress while the gesture is stationary and retracts when native scrolling ends", async () => {
  move(90);
  expect(fill()).toBe("0.6");
  await vi.advanceTimersByTimeAsync(1000);
  expect(fill()).toBe("0.6");
  scroll.dispatchEvent(new Event("scrollend"));
  expect(fill()).toBe("0");
  expect(scroll.scrollLeft).toBe(0);
  expect(onDelete).not.toHaveBeenCalled();
});

it("lets a swipe resume after a pause and deletes immediately at the far edge", async () => {
  move(30);
  await vi.advanceTimersByTimeAsync(1000);
  move(150);
  expect(fill()).toBe("1");
  expect(onDelete).toHaveBeenCalledOnce();
  scroll.dispatchEvent(new Event("scrollend"));
  expect(onDelete).toHaveBeenCalledOnce();
});

it("clears progress on reversal back to the start", () => {
  move(100);
  move(0);
  expect(fill()).toBe("0");
  expect(onDelete).not.toHaveBeenCalled();
});
