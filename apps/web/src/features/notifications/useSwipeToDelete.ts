/** @file useSwipeToDelete.ts @description Inbox dismissal through pointer drags and native trackpad scrolling. @module notifications */
import { useDrag } from "@use-gesture/react";
import { useEffect, useRef, type DragEvent, type UIEvent } from "react";

const dragThreshold = 8;
const minimumDrag = 48;
const momentumIdleMs = 150;
const wheelBlockedUntil = new WeakMap<Element, number>();

function paint(row: HTMLDivElement, progress: number) {
  row.style.setProperty(
    "--notification-swipe-progress",
    String(Math.max(0, Math.min(1, progress))),
  );
}

function retract(row: HTMLDivElement) {
  delete row.dataset.swiping;
  delete row.dataset.completing;
  paint(row, 0);
}

export function useSwipeToDelete(disabled: boolean, onDelete: () => Promise<void>) {
  const rowRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const committing = useRef(false);

  function commit(row: HTMLDivElement) {
    if (disabled || committing.current) return;
    committing.current = true;
    delete row.dataset.swiping;
    row.dataset.completing = "";
    paint(row, 1);
    void onDelete()
      .catch(() => retract(row))
      .finally(() => {
        committing.current = false;
      });
  }

  useEffect(() => {
    const scroll = scrollRef.current;
    const row = rowRef.current;
    if (!scroll || !row) return;
    const end = () => {
      if (dragging.current || committing.current) return;
      retract(row);
      if (scroll.scrollLeft !== 0) scroll.scrollLeft = 0;
    };
    scroll.addEventListener("scrollend", end);
    return () => scroll.removeEventListener("scrollend", end);
  }, []);

  useDrag(
    ({ first, last, canceled, event, initial: [x], movement: [dx] }) => {
      const row = rowRef.current;
      const scroll = scrollRef.current;
      if (!row || !scroll) return;
      if (first) {
        dragging.current = true;
        scroll.scrollLeft = 0;
      }
      const travel = Math.max(minimumDrag, x - row.getBoundingClientRect().left);
      if (last) {
        dragging.current = false;
        const moved = "clientX" in event ? x - event.clientX : -dx + dragThreshold;
        if (!canceled && !event.type.endsWith("cancel") && moved >= travel) commit(row);
        else retract(row);
        return;
      }
      row.dataset.swiping = "";
      paint(row, -dx / (travel - dragThreshold));
    },
    {
      target: rowRef,
      enabled: !disabled,
      axis: "x",
      threshold: dragThreshold,
      filterTaps: true,
      pointer: { keys: false },
    },
  );

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const row = rowRef.current;
    const scroll = event.currentTarget;
    const { scrollLeft, scrollWidth, clientWidth } = scroll;
    if (!row || dragging.current || committing.current) return;
    if (scrollLeft <= 0) {
      retract(row);
      return;
    }
    const list = scroll.closest("ul") ?? scroll;
    if (disabled || (wheelBlockedUntil.get(list) ?? 0) > Date.now()) {
      wheelBlockedUntil.set(list, Date.now() + momentumIdleMs);
      scroll.scrollLeft = 0;
      retract(row);
      return;
    }

    const travel = scrollWidth - clientWidth;
    if (travel <= 0) return;
    if (scrollLeft >= travel - 1) {
      // A fling's remaining scroll events may target the row that moves underneath it.
      wheelBlockedUntil.set(list, Date.now() + momentumIdleMs);
      commit(row);
      scroll.scrollLeft = 0;
      return;
    }
    row.dataset.swiping = "";
    paint(row, scrollLeft / travel);
  }

  return {
    row: { ref: rowRef, onDragStart: (event: DragEvent<HTMLDivElement>) => event.preventDefault() },
    scroll: { ref: scrollRef, onScroll },
  };
}
