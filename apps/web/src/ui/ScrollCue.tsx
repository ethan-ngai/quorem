/** @file ScrollCue.tsx @description Shared scroll viewport with a directional overflow hint. @module ui */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type UIEvent,
} from "react";
import { Icon } from "./Icon";
import "./scroll-cue.css";

/** Marks overflow at the end of either scroll axis. Use className to size the wrapper. */
export function ScrollCue({
  axis = "vertical",
  className,
  viewportClassName,
  resetKey,
  children,
  dir,
  onScroll,
  ...viewportProps
}: ComponentPropsWithoutRef<"div"> & {
  axis?: "vertical" | "horizontal";
  viewportClassName?: string;
  resetKey?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLSpanElement>(null);
  const [hasMore, setHasMore] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useLayoutEffect(() => {
    if (!viewport.current) return;
    viewport.current.scrollTop = 0;
    viewport.current.scrollLeft = 0;
  }, [axis, resetKey]);
  useEffect(() => {
    if (!viewport.current || !end.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setHasMore(!entry.isIntersecting), {
      root: viewport.current,
    });
    observer.observe(end.current);
    return () => observer.disconnect();
  }, [axis]);
  useEffect(() => () => clearTimeout(idleTimer.current), []);
  function handleScroll(event: UIEvent<HTMLDivElement>) {
    onScroll?.(event);
    setScrolling(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setScrolling(false), 300);
  }
  return (
    <div
      className={className ? `scroll-cue ${className}` : "scroll-cue"}
      data-axis={axis}
      dir={dir}
    >
      <div
        ref={viewport}
        className={viewportClassName}
        {...viewportProps}
        data-slot="scroll-cue-viewport"
        onScroll={handleScroll}
      >
        <div className="scroll-cue-content">
          {children}
          <span ref={end} className="scroll-cue-end" aria-hidden="true" />
        </div>
      </div>
      <div
        className="scroll-cue-indicator"
        data-visible={hasMore}
        data-scrolling={scrolling}
        aria-hidden="true"
      >
        <Icon name="chevron" width={18} height={18} strokeWidth={2} />
      </div>
    </div>
  );
}
