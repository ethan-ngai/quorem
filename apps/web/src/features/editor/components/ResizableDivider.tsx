/** @file ResizableDivider.tsx @description Keyboard and pointer splitter for workspace panes. @module editor */
import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

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
  onChange: (value: number) => void;
}) {
  const isVertical = axis === "x";
  const drag = useRef<{ pointerId: number; rect: DOMRect } | undefined>(undefined);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current || !event.isPrimary) return;
    const grid = event.currentTarget.parentElement;
    if (!grid) return;
    event.preventDefault();
    drag.current = { pointerId: event.pointerId, rect: grid.getBoundingClientRect() };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    const { rect } = drag.current;
    const next = isVertical
      ? ((event.clientX - rect.left) / rect.width) * 100
      : rect.bottom - event.clientY;
    onChange(Math.min(maximum, Math.max(minimum, next)));
  };
  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = undefined;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = isVertical
      ? event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : 0
      : event.key === "ArrowDown"
        ? -1
        : event.key === "ArrowUp"
          ? 1
          : 0;
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
      aria-valuetext={
        isVertical
          ? `${Math.round(value)} percent problem pane`
          : `${Math.round(value)} pixels results pane`
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onKeyDown={onKeyDown}
      style={{ "--split-value": `${value}${isVertical ? "%" : "px"}` } as CSSProperties}
    />
  );
}
