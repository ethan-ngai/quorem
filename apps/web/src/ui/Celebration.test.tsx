// @vitest-environment happy-dom
/** @file Celebration.test.tsx @description Confetti anchoring, reduced motion and cancellation. @module ui */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Celebration } from "./Celebration";
const mocks = vi.hoisted(() => {
  const fire = Object.assign(vi.fn(), { reset: vi.fn() });
  return { fire, create: vi.fn(() => fire) };
});
vi.mock("canvas-confetti", () => ({ default: { create: mocks.create } }));
let panel: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillRect: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray([40, 120, 240, 255]) }),
  } as unknown as CanvasRenderingContext2D);
  panel = document.createElement("div");
  panel.style.overflow = "auto";
  panel.getBoundingClientRect = () =>
    ({ left: 200, right: 720, top: 100, width: 520, height: 400 }) as DOMRect;
  document.body.append(panel);
  root = createRoot(panel);
});
afterEach(async () => {
  await act(async () => root.unmount());
  panel.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("launches from behind both panel edges outside its scrolling boundary, then cancels on dismissal", async () => {
  await act(async () => {
    root.render(
      <StrictMode>
        <Celebration outcome="success" />
      </StrictMode>,
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(180);
  });
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(panel.querySelector("canvas")).toBeNull();
  expect(document.body.querySelector(".celebration-canvas")?.getAttribute("aria-hidden")).toBe(
    "true",
  );
  expect(mocks.fire).toHaveBeenCalledWith(
    expect.objectContaining({ angle: 125, origin: { x: 224 / innerWidth, y: 360 / innerHeight } }),
  );
  expect(mocks.fire).toHaveBeenCalledWith(
    expect.objectContaining({ angle: 55, origin: { x: 696 / innerWidth, y: 360 / innerHeight } }),
  );
  await act(async () => root.render(null));
  await vi.advanceTimersByTimeAsync(200);
  expect(mocks.fire).toHaveBeenCalledTimes(2);
  expect(mocks.fire.reset).toHaveBeenCalledTimes(1);
  expect(document.body.querySelector(".celebration-canvas")).toBeNull();
});
it("skips library loading and particles under reduced motion", async () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  await act(async () => {
    root.render(<Celebration outcome="success" />);
  });
  await vi.advanceTimersByTimeAsync(500);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("launches popup-free celebrations inward from beyond both viewport edges", async () => {
  await act(async () => root.render(<Celebration outcome="success" inline />));
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(mocks.fire).toHaveBeenCalledWith(
    expect.objectContaining({ angle: 55, origin: { x: -24 / innerWidth, y: 0.55 } }),
  );
  expect(mocks.fire).toHaveBeenCalledWith(
    expect.objectContaining({ angle: 125, origin: { x: 1 + 24 / innerWidth, y: 0.55 } }),
  );
});
it("cancels a pending burst before the dialog settles", async () => {
  await act(async () => {
    root.render(<Celebration outcome="success" />);
  });
  await act(async () => root.render(null));
  await vi.advanceTimersByTimeAsync(500);
  expect(mocks.create).not.toHaveBeenCalled();
});

it.each(["loss", "pending", "neutral"] as const)(
  "never loads confetti for a %s viewer",
  async (outcome) => {
    await act(async () => {
      root.render(<Celebration outcome={outcome} />);
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(document.body.querySelector(".celebration-canvas")).toBeNull();
  },
);
it("allows observers to celebrate success", async () => {
  await act(async () => {
    root.render(<Celebration outcome="observer" />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(180);
  });
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
it("stops active confetti when the viewer becomes a loser", async () => {
  await act(async () => {
    root.render(<Celebration outcome="success" />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(180);
  });
  await act(async () => {
    root.render(<Celebration outcome="loss" />);
  });
  await vi.advanceTimersByTimeAsync(200);
  expect(mocks.fire).toHaveBeenCalledTimes(2);
  expect(mocks.fire.reset).toHaveBeenCalledTimes(1);
  expect(document.body.querySelector(".celebration-canvas")).toBeNull();
});
