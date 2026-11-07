/** @file AnimatedRows.tsx @description Motion and stable identity for editable collections. @module ui */
import { motion } from "@quorem/ui/tokens";
import { Component, type ReactNode, type RefObject } from "react";

type Row<Item> = { item: Item; key: number };
type Props<Item> = {
  items: readonly Item[];
  heading?: ReactNode;
  className?: string;
  rowClassName?: string;
  as?: "ul" | "ol" | "tbody";
  label?: string;
  inline?: boolean;
  empty?: ReactNode;
  getKey?: (item: Item) => unknown;
  preserveEdits?: boolean;
  renderRow: (item: Item, index: number) => ReactNode;
  focusFallback?: RefObject<HTMLElement | null>;
};
type State<Item> = { items: readonly Item[]; rows: Row<Item>[]; nextKey: number };
type Exit = { copy: HTMLElement; size: number; before?: number };
type Snapshot = {
  exits: Exit[];
  entered: number[];
  restoreFocus: boolean;
  focusKey?: number;
};

const timing = { duration: Number.parseFloat(motion.standard), easing: motion.easing };

function elements(container: HTMLElement) {
  return new Map(
    Array.from(container.querySelectorAll<HTMLElement>(":scope > [data-motion-row]"), (row) => [
      Number(row.dataset.motionRow),
      row,
    ]),
  );
}

/** Animates committed list changes while form values and validation update immediately. */
export class AnimatedRows<Item> extends Component<Props<Item>, State<Item>, Snapshot | null> {
  private container: HTMLElement | null = null;
  private readonly setContainer = (node: HTMLElement | null) => {
    this.container = node;
  };

  state: State<Item> = {
    items: this.props.items,
    rows: this.props.items.map((item, key) => ({ item, key })),
    nextKey: this.props.items.length,
  };

  static getDerivedStateFromProps<Item>(
    { items, getKey, preserveEdits = !getKey }: Props<Item>,
    previous: State<Item>,
  ): State<Item> | null {
    if (items === previous.items) return null;
    if (getKey && preserveEdits && items.length === previous.rows.length) {
      // Editable grids reparse every row on each keystroke, and duplicate values are valid.
      return {
        ...previous,
        items,
        rows: items.map((item, index) => ({ item, key: previous.rows[index]!.key })),
      };
    }
    const buckets = new Map<unknown, number[]>();
    for (const { item, key } of [...previous.rows].reverse()) {
      const identity = getKey ? getKey(item) : item;
      const bucket = buckets.get(identity);
      if (bucket) bucket.push(key);
      else buckets.set(identity, [key]);
    }
    // Match survivors before assigning any unused positions to edited values.
    const used = new Set<number>();
    const matches = items.map((item) => {
      const key = buckets.get(getKey ? getKey(item) : item)?.pop();
      if (key !== undefined) used.add(key);
      return key;
    });
    const edited = preserveEdits ? previous.rows.filter((row) => !used.has(row.key)).reverse() : [];
    let nextKey = previous.nextKey;
    const rows = items.map((item, index) => ({
      item,
      key: matches[index] ?? edited.pop()?.key ?? nextKey++,
    }));
    return { items, rows, nextKey };
  }

  getSnapshotBeforeUpdate(previousProps: Props<Item>, previous: State<Item>): Snapshot | null {
    const container = this.container;
    if (
      !container ||
      (Boolean(previousProps.heading) === Boolean(this.props.heading) &&
        previous.rows.length === this.state.rows.length &&
        previous.rows.every(({ key }, index) => key === this.state.rows[index]?.key))
    )
      return null;
    const before = elements(container);
    const after = this.keys();
    const surviving = new Set(after);
    const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const exits: Exit[] = [];
    let restoreFocus = false;
    let focusKey: number | undefined;
    const previousKeys = [...before.keys()];
    let anchor: number | undefined;
    for (let index = previousKeys.length - 1; index >= 0; index--) {
      const key = previousKeys[index]!;
      if (surviving.has(key)) {
        anchor = key;
        continue;
      }
      const row = before.get(key)!;
      const next = after[Math.min(index, after.length - 1)];
      if (row.contains(document.activeElement)) {
        restoreFocus = true;
        focusKey = next;
      }
      if (!animate) continue;
      const rect = row.getBoundingClientRect();
      const size = this.props.inline ? rect.width : rect.height;
      if (!size) continue;
      const copy = row.cloneNode(true) as HTMLElement;
      copy.removeAttribute("data-motion-row");
      copy.inert = true;
      copy.setAttribute("aria-hidden", "true");
      copy.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      // A visual copy inside a form must not participate in validation or submission.
      copy
        .querySelectorAll("input, select, textarea, button")
        .forEach((element) => element.setAttribute("form", ""));
      exits.push({ copy, size, before: anchor });
    }
    return {
      exits: exits.reverse(),
      entered: animate ? after.filter((key) => !before.has(key)) : [],
      restoreFocus,
      focusKey,
    };
  }

  componentDidUpdate(_props: Props<Item>, _state: State<Item>, snapshot: Snapshot | null) {
    const container = this.container;
    if (!container || !snapshot) return;
    const rows = elements(container);
    const sizeProperty = this.props.inline ? "inlineSize" : "blockSize";
    const table = this.props.as === "tbody";
    for (const { copy, size, before } of snapshot.exits) {
      copy.style.overflow = "clip";
      container.insertBefore(copy, (before === undefined ? null : rows.get(before)) ?? null);
      const frames = table
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { [sizeProperty]: `${size}px`, opacity: 1 },
            { [sizeProperty]: "0px", opacity: 0 },
          ];
      const animation = copy.animate(frames, timing);
      void animation.finished.then(
        () => copy.remove(),
        () => copy.remove(),
      );
    }
    for (const key of snapshot.entered) {
      rows.get(key)?.animate(
        [
          { opacity: 0, translate: "0 -3px" },
          { opacity: 1, translate: "0 0" },
        ],
        timing,
      );
    }
    if (snapshot.restoreFocus && document.activeElement === document.body) {
      const row = snapshot.focusKey === undefined ? undefined : rows.get(snapshot.focusKey);
      const next = row?.querySelector<HTMLElement>(
        "summary, button:not(:disabled), input:not(:disabled), textarea:not(:disabled)",
      );
      (next ?? this.props.focusFallback?.current)?.focus({ preventScroll: true });
    }
  }

  private keys() {
    const keys = this.state.rows.map(({ key }) => key);
    return this.props.heading && keys.length ? [-1, ...keys] : keys;
  }

  render() {
    const {
      as: Container = "div",
      heading,
      className,
      rowClassName,
      label,
      empty,
      renderRow,
    } = this.props;
    const Row = Container === "tbody" ? "tr" : Container === "div" ? "div" : "li";
    const rowClass =
      Row === "div" ? ["animated-row", rowClassName].filter(Boolean).join(" ") : rowClassName;
    return (
      <Container ref={this.setContainer} className={className} aria-label={label}>
        {heading && this.state.rows.length > 0 && (
          <div className="animated-row" data-motion-row={-1}>
            {heading}
          </div>
        )}
        {this.state.rows.map(({ item, key }, index) => (
          <Row className={rowClass} data-motion-row={key} key={key}>
            {renderRow(item, index)}
          </Row>
        ))}
        {this.state.rows.length === 0 && empty}
      </Container>
    );
  }
}
