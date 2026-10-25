/** @file remoteCursor.ts @description Transient cursor names with hover rediscovery. @module collaboration */
import { WidgetType } from "@codemirror/view";

export const CURSOR_LABEL_DELAY = 1500;
export type CursorLabel = { visibleUntil: number };
const cleanup = new WeakMap<HTMLElement, () => void>();

export class RemoteCursor extends WidgetType {
  constructor(
    readonly name: string,
    readonly color: string,
    readonly label: CursorLabel,
  ) {
    super();
  }
  eq(other: RemoteCursor) {
    return this.name === other.name && this.color === other.color && this.label === other.label;
  }
  toDOM() {
    const cursor = document.createElement("span");
    cursor.className = "collaboration-remote-cursor";
    cursor.style.setProperty("--participant-color", this.color);
    cursor.setAttribute("aria-label", `${this.name}'s cursor`);
    const label = document.createElement("span");
    label.className = "collaboration-cursor-label";
    label.textContent = this.name;
    cursor.append(label);
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      const remaining = this.label.visibleUntil - Date.now();
      cursor.dataset.labelVisible = String(remaining > 0);
      if (remaining > 0)
        timer = setTimeout(() => {
          cursor.dataset.labelVisible = "false";
        }, remaining);
    };
    cursor.onpointerenter = () => {
      clearTimeout(timer);
      this.label.visibleUntil = Infinity;
      cursor.dataset.labelVisible = "true";
    };
    cursor.onpointerleave = () => {
      this.label.visibleUntil = Date.now() + CURSOR_LABEL_DELAY;
      schedule();
    };
    schedule();
    cleanup.set(cursor, () => {
      clearTimeout(timer);
      // Editor movement can replace a hovered widget without firing pointerleave.
      if (this.label.visibleUntil === Infinity)
        this.label.visibleUntil = Date.now() + CURSOR_LABEL_DELAY;
    });
    return cursor;
  }
  destroy(dom: HTMLElement) {
    cleanup.get(dom)?.();
    cleanup.delete(dom);
  }
}
