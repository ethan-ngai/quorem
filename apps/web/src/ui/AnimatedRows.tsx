/** @file AnimatedRows.tsx @description Motion and stable identity for editable vertical collections. @module ui */
import { motion } from "@quorem/ui/tokens";
import { Component, createRef, type ReactNode, type RefObject } from "react";

type Row<Item> = { item: Item; key: number };
type Props<Item> = {
  items: readonly Item[];
  heading?: ReactNode;
  className?: string;
  renderRow: (item: Item, index: number) => ReactNode;
  focusFallback?: RefObject<HTMLElement | null>;
};
type State<Item> = { items: readonly Item[]; rows: Row<Item>[]; nextKey: number };
type Exit = { copy: HTMLElement; height: number; before?: number };
type Snapshot = {
  exits: Exit[];
  entered: number[];
  restoreFocus: boolean;
  focusKey?: number;
};

const timing = { duration: Number.parseFloat(motion.standard), easing: motion.easing };

function elements(container: HTMLDivElement) {
  return new Map(
    Array.from(container.querySelectorAll<HTMLElement>(":scope > [data-motion-row]"), (row) => [
      Number(row.dataset.motionRow),
      row,
    ]),
  );
}

/** Animates committed list changes while form values and validation update immediately. */
export class AnimatedRows<Item> extends Component<Props<Item>, State<Item>, Snapshot | null> {
  private readonly container = createRef<HTMLDivElement>();

  state: State<Item> = {
    items: this.props.items,
    rows: this.props.items.map((item, key) => ({ item, key })),
    nextKey: this.props.items.length,
  };

  static getDerivedStateFromProps<Item>(
    { items }: Props<Item>,
    previous: State<Item>,
  ): State<Item> | null {
    if (items === previous.items) return null;
    const used = new Set<number>();
    // Match surviving references before pairing edited values with their previous positions.
    const matches = items.map((item) => {
      const row = previous.rows.find((row) => !used.has(row.key) && Object.is(row.item, item));
      if (row) used.add(row.key);
      return row;
    });
    const edited = previous.rows.filter((row) => !used.has(row.key));
    let nextKey = previous.nextKey;
    const rows = items.map((item, index) => ({
      item,
      key: matches[index]?.key ?? edited.shift()?.key ?? nextKey++,
    }));
    return { items, rows, nextKey };
  }

  getSnapshotBeforeUpdate(previousProps: Props<Item>, previous: State<Item>): Snapshot | null {
    const container = this.container.current;
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
    for (const [index, key] of previousKeys.entries()) {
      const row = before.get(key)!;
      if (surviving.has(key)) continue;
      const next = after[Math.min(index, after.length - 1)];
      if (row.contains(document.activeElement)) {
        restoreFocus = true;
        focusKey = next;
      }
      if (!animate) continue;
      const height = row.getBoundingClientRect().height;
      if (!height) continue;
      const copy = row.cloneNode(true) as HTMLElement;
      copy.removeAttribute("data-motion-row");
      copy.inert = true;
      copy.setAttribute("aria-hidden", "true");
      copy.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      // A visual copy inside a form must not participate in validation or submission.
      copy
        .querySelectorAll("input, select, textarea, button")
        .forEach((element) => element.setAttribute("form", ""));
      const following = previousKeys.slice(index + 1);
      exits.push({ copy, height, before: following.find((key) => surviving.has(key)) });
    }
    return {
      exits,
      entered: animate ? after.filter((key) => !before.has(key)) : [],
      restoreFocus,
      focusKey,
    };
  }

  componentDidUpdate(_props: Props<Item>, _state: State<Item>, snapshot: Snapshot | null) {
    const container = this.container.current;
    if (!container || !snapshot) return;
    const rows = elements(container);
    for (const { copy, height, before } of snapshot.exits) {
      copy.style.overflow = "clip";
      container.insertBefore(copy, (before === undefined ? null : rows.get(before)) ?? null);
      const animation = copy.animate(
        [
          { blockSize: `${height}px`, opacity: 1 },
          { blockSize: "0px", opacity: 0 },
        ],
        timing,
      );
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
    const { heading, className, renderRow } = this.props;
    return (
      <div ref={this.container} className={className}>
        {heading && this.state.rows.length > 0 && (
          <div className="animated-row" data-motion-row={-1}>
            {heading}
          </div>
        )}
        {this.state.rows.map(({ item, key }, index) => (
          <div className="animated-row" data-motion-row={key} key={key}>
            {renderRow(item, index)}
          </div>
        ))}
      </div>
    );
  }
}
