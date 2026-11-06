/** @file useServerTable.test.tsx @description Server rows and controlled table navigation. @module ui */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Table } from "@tanstack/react-table";
import { useServerTable } from "./useServerTable";
it("never sorts or slices an already paginated server response", () => {
  const data = [{ title: "Z" }, { title: "A" }];
  const onChange = vi.fn();
  let table!: Table<{ title: string }>;
  function Subject() {
    table = useServerTable({
      data,
      columns: [{ accessorKey: "title" }],
      total: 62,
      state: { page: 3, limit: 20, sort: "title", order: "asc" },
      onChange,
    });
    return null;
  }
  renderToStaticMarkup(<Subject />);
  expect(table.getRowModel().rows.map((row) => row.original)).toEqual(data);
  table.setPageSize(10);
  expect(onChange).toHaveBeenLastCalledWith({ page: 1, limit: 10, sort: "title", order: "asc" });
  table.nextPage();
  expect(onChange).toHaveBeenLastCalledWith({ page: 4, limit: 20, sort: "title", order: "asc" });
  table.getColumn("title")!.toggleSorting();
  expect(onChange).toHaveBeenLastCalledWith({ page: 1, limit: 20, sort: "title", order: "desc" });
});
