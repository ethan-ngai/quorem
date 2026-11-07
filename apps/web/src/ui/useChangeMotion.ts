/** @file useChangeMotion.ts @description Feedback for content replaced inside a stable surface. @module ui */
import { motion } from "@quorem/ui/tokens";
import { useLayoutEffect, useRef } from "react";

/** A short reveal that preserves the element, focus, and scroll position. */
export function useChangeMotion<Element extends HTMLElement>(
  value: string | number | undefined,
  variant: "fade" | "slide" = "fade",
) {
  const node = useRef<Element>(null);
  const previous = useRef(value);
  useLayoutEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const frames =
      variant === "slide"
        ? [
            { opacity: 0, translate: "0 6px" },
            { opacity: 1, translate: "0 0" },
          ]
        : [{ opacity: 0.65 }, { opacity: 1 }];
    const animation = node.current?.animate(frames, {
      duration: Number.parseFloat(variant === "slide" ? motion.standard : motion.fast),
      easing: motion.easing,
      fill: "backwards",
    });
    return () => animation?.cancel();
  }, [value, variant]);
  return node;
}
