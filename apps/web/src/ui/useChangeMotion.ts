/** @file useChangeMotion.ts @description Feedback for content replaced inside a stable surface. @module ui */
import { motion } from "@quorem/ui/tokens";
import { useLayoutEffect, useRef } from "react";

/** A short reveal that preserves the element, focus, and scroll position. */
export function useChangeMotion<Element extends HTMLElement>(value: string | number | undefined) {
  const node = useRef<Element>(null);
  const previous = useRef(value);
  useLayoutEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = node.current?.animate([{ opacity: 0.65 }, { opacity: 1 }], {
      duration: Number.parseFloat(motion.fast),
      easing: motion.easing,
    });
    return () => animation?.cancel();
  }, [value]);
  return node;
}
