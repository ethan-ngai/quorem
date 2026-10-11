/** @file ResizableDivider.tsx @description Keyboard and pointer splitter for workspace panes. @module editor */
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

/** Exposes a named splitter whose value can be changed by pointer or arrow keys. */
export function ResizableDivider({
  axis,
  value,
  minimum,
  maximum,
  onChange,
}: {
  axis: "x" | "y";
  value: number;
  minimum: number;
  maximum: number;
  onChange(value: number): void;
}) {
  const isVertical = axis === "x";
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const splitter = event.currentTarget;
    const grid = splitter.parentElement;
    if (!grid) return;
    splitter.setPointerCapture(event.pointerId);
    const rect = grid.getBoundingClientRect();
    const update = (pointerEvent: globalThis.PointerEvent) => {
      const next = isVertical
        ? ((pointerEvent.clientX - rect.left) / rect.width) * 100
        : rect.bottom - pointerEvent.clientY;
      onChange(Math.min(maximum, Math.max(minimum, next)));
    };
    const finish = () => {
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", finish, { once: true });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = isVertical
      ? event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0
      : event.key === "ArrowDown" ? -1 : event.key === "ArrowUp" ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    onChange(Math.min(maximum, Math.max(minimum, value + direction * (isVertical ? 2 : 16))));
  };
  return (
    <div
      className={`splitter splitter-${axis}`}
      role="separator"
      tabIndex={0}
      aria-label={isVertical ? "Resize problem and editor panes" : "Resize results pane"}
      aria-orientation={isVertical ? "vertical" : "horizontal"}
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={Math.round(value)}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      style={{ "--split-value": `${value}${isVertical ? "%" : "px"}` } as CSSProperties}
    />
  );
}
