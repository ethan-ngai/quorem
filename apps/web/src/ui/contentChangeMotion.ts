/** @file contentChangeMotion.ts @description Crossfade replaced content without moving its controls. @module ui */
import { motion } from "@quorem/ui/tokens";

/** Capture the outgoing surface before a synchronous or React-driven update. */
export function prepareContentChangeMotion(
  surface: HTMLElement,
  resizeWidth = false,
): (() => () => void) | undefined {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const { width, height } = surface.getBoundingClientRect();
  const outgoing = surface.cloneNode(true) as HTMLElement;
  outgoing.inert = true;
  outgoing.setAttribute("aria-hidden", "true");
  outgoing.removeAttribute("id");
  outgoing.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  Object.assign(outgoing.style, {
    position: "absolute",
    inset: "0",
    width: resizeWidth ? `${width}px` : "100%",
    height: `${height}px`,
    pointerEvents: "none",
    zIndex: "1",
  });
  return () => {
    const { width: nextWidth, height: nextHeight } = surface.getBoundingClientRect();
    const live = surface.firstElementChild;
    const previousPosition = surface.style.position;
    const previousOverflow = surface.style.overflow;
    surface.style.position = "relative";
    surface.style.overflow = "clip";
    surface.append(outgoing);

    const timing = {
      duration: Number.parseFloat(motion.standard),
      easing: motion.easing,
      fill: "both" as const,
    };
    const animations = [outgoing.animate([{ opacity: 1 }, { opacity: 0 }], timing)];
    if (live) animations.push(live.animate([{ opacity: 0 }, { opacity: 1 }], timing));
    if (height !== nextHeight)
      animations.push(
        surface.animate([{ height: `${height}px` }, { height: `${nextHeight}px` }], timing),
      );
    if (resizeWidth && width !== nextWidth)
      animations.push(
        surface.animate([{ width: `${width}px` }, { width: `${nextWidth}px` }], timing),
      );

    let done = false;
    const clear = () => {
      if (done) return;
      done = true;
      animations.forEach((animation) => animation.cancel());
      outgoing.remove();
      surface.style.position = previousPosition;
      surface.style.overflow = previousOverflow;
    };
    void Promise.all(animations.map((animation) => animation.finished)).then(clear, clear);
    return clear;
  };
}

/** Snapshot only the outgoing surface; the live content retains focus and accessibility. */
export function contentChangeMotion(surface: HTMLElement, replace: () => void): () => void {
  const start = prepareContentChangeMotion(surface);
  replace();
  return start?.() ?? (() => {});
}
