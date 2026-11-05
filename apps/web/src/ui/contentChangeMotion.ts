/** @file contentChangeMotion.ts @description Crossfade replaced content without moving its controls. @module ui */
import { motion } from "@quorem/ui/tokens";

/** Snapshot only the outgoing surface; the live content retains focus and accessibility. */
export function contentChangeMotion(surface: HTMLElement, replace: () => void): () => void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    replace();
    return () => {};
  }
  const height = surface.getBoundingClientRect().height;
  const outgoing = surface.cloneNode(true) as HTMLElement;
  outgoing.inert = true;
  outgoing.setAttribute("aria-hidden", "true");
  outgoing.removeAttribute("id");
  outgoing.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  Object.assign(outgoing.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    pointerEvents: "none",
    zIndex: "1",
  });
  const previousPosition = surface.style.position;
  const previousOverflow = surface.style.overflow;
  surface.style.position = "relative";
  replace();
  surface.append(outgoing);
  const animations: Animation[] = [];
  let done = false;
  const clear = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    animations.forEach((animation) => animation.cancel());
    outgoing.remove();
    surface.style.position = previousPosition;
    surface.style.overflow = previousOverflow;
  };
  const frame = requestAnimationFrame(() => {
    const nextHeight = surface.getBoundingClientRect().height;
    const timing = { duration: Number.parseFloat(motion.standard), easing: motion.easing };
    surface.style.overflow = "hidden";
    animations.push(outgoing.animate([{ opacity: 1 }, { opacity: 0 }], timing));
    const live = surface.firstElementChild;
    if (live) animations.push(live.animate([{ opacity: 0 }, { opacity: 1 }], timing));
    animations.push(
      surface.animate([{ height: `${height}px` }, { height: `${nextHeight}px` }], timing),
    );
    Promise.all(animations.map((animation) => animation.finished)).then(clear, clear);
  });
  return clear;
}
