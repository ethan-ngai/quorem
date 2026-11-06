/** @file Celebration.tsx @description Physics-based side bursts, respecting reduced motion. @module ui */
import { useEffect, useRef } from "react";
import type { Options } from "canvas-confetti";
import { canCelebrate, type CompletionOutcome } from "./completionOutcome";
import "./celebration.css";

/** Each completion owns its canvas and animation lifecycle. */
export function Celebration({
  outcome,
  inline = false,
}: {
  outcome: CompletionOutcome;
  inline?: boolean;
}) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!canCelebrate(outcome)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let disposed = false;
    let canvas: HTMLCanvasElement | undefined;
    let reset: (() => void) | undefined;
    let followup: ReturnType<typeof setTimeout> | undefined;
    const start = setTimeout(() => {
      void import("canvas-confetti")
        .then(({ default: confetti }) => {
          if (disposed) return;
          const bounds = inline
            ? undefined
            : marker.current?.parentElement?.getBoundingClientRect();
          const width = window.innerWidth;
          const height = window.innerHeight;
          const inset = bounds ? Math.min(24, bounds.width / 4) : 0;
          const left = bounds ? bounds.left + inset : -24;
          const right = bounds ? bounds.right - inset : width + 24;
          const y = (bounds ? bounds.top + bounds.height * 0.65 : height * 0.55) / height;

          // Convert theme tokens to hex; canvas-confetti's color parser expects hex.
          const probe = document.createElement("canvas");
          probe.width = probe.height = 1;
          const context = probe.getContext("2d", { willReadFrequently: true });
          if (!context) return;
          const theme = getComputedStyle(document.documentElement);
          const colors = ["primary", "success", "warning", "brand-accent"].map((token) => {
            context.fillStyle = theme.getPropertyValue(`--color-${token}`).trim();
            context.fillRect(0, 0, 1, 1);
            return `#${Array.from(context.getImageData(0, 0, 1, 1).data)
              .slice(0, 3)
              .map((value) => value.toString(16).padStart(2, "0"))
              .join("")}`;
          });
          canvas = document.createElement("canvas");
          canvas.className = "celebration-canvas";
          canvas.setAttribute("aria-hidden", "true");
          document.body.append(canvas);
          const fire = confetti.create(canvas, {
            resize: true,
            useWorker: true,
            disableForReducedMotion: true,
          });
          reset = fire.reset;
          const burst = (particleCount: number, startVelocity: number) => {
            const options: Options = {
              particleCount,
              startVelocity,
              spread: 110,
              gravity: 1.15,
              decay: 0.95,
              ticks: 150,
              scalar: 0.95,
              colors,
              shapes: ["square", "circle"],
            };
            const finish = fire({
              ...options,
              angle: bounds ? 125 : 55,
              origin: { x: left / width, y },
            });
            void fire({
              ...options,
              angle: bounds ? 55 : 125,
              origin: { x: right / width, y },
            });
            return finish;
          };
          void burst(90, 30)?.then(() => canvas?.remove());
          followup = setTimeout(() => {
            void burst(26, 22);
          }, 140);
        })
        .catch(() => {
          /* Decorative loading failures must not interrupt completion. */
        });
    }, 180);
    return () => {
      disposed = true;
      clearTimeout(start);
      clearTimeout(followup);
      reset?.();
      canvas?.remove();
    };
  }, [inline, outcome]);
  return canCelebrate(outcome) ? <span ref={marker} hidden /> : null;
}
