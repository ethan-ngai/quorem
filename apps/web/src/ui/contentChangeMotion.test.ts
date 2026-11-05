import { afterEach, expect, it, vi } from "vitest";
import { contentChangeMotion } from "./contentChangeMotion";

afterEach(() => vi.unstubAllGlobals());

it("replaces immediately without snapshots or animation under reduced motion", () => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
  const replace = vi.fn();
  const cloneNode = vi.fn();
  const cancel = contentChangeMotion({ cloneNode } as unknown as HTMLElement, replace);
  expect(replace).toHaveBeenCalledOnce();
  expect(cloneNode).not.toHaveBeenCalled();
  expect(cancel).not.toThrow();
});
