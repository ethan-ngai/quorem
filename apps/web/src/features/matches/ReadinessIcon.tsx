/** @file ReadinessIcon.tsx @description Reversible clock-to-check readiness feedback. @module matches */
import { useEffect, useRef } from "react";

const clock = "M12 8 L12 12 L15 14";
const check = "M8 12 L11 15 L16 9";

export function ReadinessIcon({ ready }: { ready: boolean }) {
  const animation = useRef<SVGAnimateElement>(null);
  const previous = useRef(ready);
  useEffect(() => {
    const element = animation.current;
    if (!element || previous.current === ready) return;
    element.setAttribute("from", previous.current ? check : clock);
    element.setAttribute("to", ready ? check : clock);
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
      <circle cx="12" cy="12" r="9" />
      <path d={ready ? check : clock}>
        <animate ref={animation} attributeName="d" begin="indefinite" />
      </path>
    </svg>
  );
}
