// @vitest-environment happy-dom
import { motion } from "@quorem/ui/tokens";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CopyFeedbackIcon } from "./CopyFeedbackIcon";

it.each([false, true])("uses shared or reduced duration (reduced: %s)", async (reduced) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<CopyFeedbackIcon copied={false} />));
  const animation = container.querySelector("animate")!;
  const begin = vi.fn();
  Object.assign(animation, { beginElement: begin });
  await act(async () => root.render(<CopyFeedbackIcon copied />));
  expect(animation.getAttribute("dur")).toBe(reduced ? "0.001s" : motion.standard);
  expect(begin).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
