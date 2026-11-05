import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AnimatedRows } from "./AnimatedRows";

it("keeps edited SQL rows in place when the new value duplicates a neighbor", () => {
  const rows = [[1], [2]];
  const items = [[2], [2]];
  const next = AnimatedRows.getDerivedStateFromProps(
    { items, getKey: JSON.stringify, preserveEdits: true, renderRow: () => null },
    { items: rows, rows: rows.map((item, key) => ({ item, key })), nextKey: 2 },
  );
  expect(next?.rows.map(({ key }) => key)).toEqual([0, 1]);
});

it("keeps refreshed roster members keyed by identity while replacing departures", () => {
  const members = [{ id: "old" }, { id: "stays" }];
  const items = [{ id: "stays" }, { id: "new" }];
  const next = AnimatedRows.getDerivedStateFromProps(
    { items, getKey: (member) => member.id, renderRow: () => null },
    { items: members, rows: members.map((item, key) => ({ item, key })), nextKey: 2 },
  );
  expect(next?.rows.map(({ key }) => key)).toEqual([1, 2]);
});

it("keeps native rows and cells inside an animated table body", () => {
  const html = renderToStaticMarkup(
    <table>
      <AnimatedRows as="tbody" items={["cell"]} renderRow={(item) => <td>{item}</td>} />
    </table>,
  );
  expect(html).toBe('<table><tbody><tr data-motion-row="0"><td>cell</td></tr></tbody></table>');
});
