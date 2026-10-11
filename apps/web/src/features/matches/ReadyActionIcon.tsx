/** @file ReadyActionIcon.tsx @description Reversible check-to-cross action morph. @module matches */
import { useEffect, useRef } from "react";

const check = "M5 12 L9 16 M9 16 L19 6";
const cross = "M6 6 L18 18 M6 18 L18 6";

export function ReadyActionIcon({ ready }: { ready: boolean }) {
  const animation = useRef<SVGAnimateElement>(null);
  const previous = useRef(ready);
  useEffect(() => {
    const element = animation.current;
    if (!element || previous.current === ready) return;
    element.setAttribute("from", previous.current ? cross : check);
    element.setAttribute("to", ready ? cross : check);
    element.setAttribute(
      "dur",
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "0.001s" : "0.18s",
    );
    element.beginElement();
    previous.current = ready;
  }, [ready]);
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ready ? cross : check}>
        <animate ref={animation} attributeName="d" begin="indefinite" />
      </path>
    </svg>
  );
}
