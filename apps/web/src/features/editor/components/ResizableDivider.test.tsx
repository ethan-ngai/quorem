// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ResizableDivider } from "./ResizableDivider";

it("stops a captured drag on cancellation and ignores other pointers", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  await act(async () =>
    root.render(
      <ResizableDivider axis="x" value={40} minimum={25} maximum={60} onChange={change} />,
    ),
  );
  const divider = container.querySelector<HTMLDivElement>('[role="separator"]')!;
  divider.setPointerCapture = vi.fn();
  container.getBoundingClientRect = () => ({ left: 0, width: 100, bottom: 100 }) as DOMRect;
  const pointer = (type: string, pointerId: number, clientX: number) =>
    divider.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerId, clientX, isPrimary: true }),
    );
  await act(async () => pointer("pointerdown", 1, 30));
  await act(async () => pointer("pointermove", 2, 50));
  expect(change).not.toHaveBeenCalled();
  await act(async () => pointer("pointermove", 1, 50));
  expect(change).toHaveBeenCalledWith(50);
  await act(async () => pointer("pointercancel", 1, 50));
  await act(async () => pointer("pointermove", 1, 55));
  expect(change).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
