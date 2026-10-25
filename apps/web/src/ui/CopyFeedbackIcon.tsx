import { useEffect, useRef } from "react";

const copy = "M9 9 L21 9 L21 21 L9 21 L9 9";
const check = "M5 12 L10 17 L19 7 L19 7 L19 7";

/** Matching path segments interpolate in Safari and Chromium through SVG animation. */
export function CopyFeedbackIcon({ copied }: { copied: boolean }) {
  const animation = useRef<SVGAnimateElement>(null);
  const previous = useRef(copied);
  useEffect(() => {
    const element = animation.current;
    if (!element || previous.current === copied) return;
    element.setAttribute("from", previous.current ? check : copy);
    element.setAttribute("to", copied ? check : copy);
    element.setAttribute(
      "dur",
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "0.001s" : "0.18s",
    );
    element.beginElement();
    previous.current = copied;
  }, [copied]);
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
      <path className="copy-back" d="M5 15H3V3h12v2" />
      <path d={copied ? check : copy}>
        <animate ref={animation} attributeName="d" begin="indefinite" />
      </path>
    </svg>
  );
}
