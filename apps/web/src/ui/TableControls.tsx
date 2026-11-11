/** @file TableControls.tsx @description Shared server sorting and page controls. @module ui */
import type { Column, ReactTable, RowData } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { PageSizeControl } from "./PageSizeControl";
import { Tooltip } from "./Tooltip";
import type { ListState, serverTableFeatures } from "./useServerTable";
import "./table.css";
export function TableSortHeader<T extends RowData>({
  column,
  children,
  disabled,
  className,
}: {
  column: Column<typeof serverTableFeatures, T>;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const sorted = column.getIsSorted();
  const Icon = sorted === "desc" ? ArrowDown : ArrowUp;
  return (
    <th
      className={className}
      scope="col"
      aria-sort={sorted === "desc" ? "descending" : sorted === "asc" ? "ascending" : "none"}
    >
      <button type="button" disabled={disabled} onClick={column.getToggleSortingHandler()}>
        {children}
        {sorted && <Icon size={13} aria-hidden="true" />}
      </button>
    </th>
  );
}
export function TablePagination<T extends RowData>({
  table,
  disabled = false,
  snapshot,
}: {
  table: ReactTable<typeof serverTableFeatures, T>;
  disabled?: boolean;
  snapshot?: Pick<ListState, "page" | "limit">;
}) {
  // Display the page these rows came from; don't navigate from stale totals.
  const { pageIndex, pageSize } = snapshot
    ? { pageIndex: snapshot.page - 1, pageSize: snapshot.limit }
    : table.state.pagination;
  const unavailable = disabled || !!snapshot;
  const total = table.getRowCount();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <footer className="table-pagination">
      <span role="status">
        {total
          ? `${Math.min(pageIndex * pageSize + 1, total)}–${Math.min((pageIndex + 1) * pageSize, total)} of ${total}`
          : "0 entries"}
      </span>
      <div>
        <PageSizeControl
          value={pageSize}
          onChange={(size) => table.setPageSize(size)}
          disabled={unavailable}
        />
        <div className="table-page-navigation">
          <Tooltip content="Previous page">
            <button
              type="button"
              className="table-page-button"
              aria-label="Previous page"
              disabled={disabled || pageIndex === 0}
              aria-disabled={!!snapshot || undefined}
              onClick={() => {
                if (!snapshot) table.previousPage();
              }}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
          </Tooltip>
          <span>
            Page {pageIndex + 1} of {pages}
          </span>
          <Tooltip content="Next page">
            <button
              type="button"
              className="table-page-button"
              aria-label="Next page"
              disabled={disabled || pageIndex + 1 >= pages}
              aria-disabled={!!snapshot || undefined}
              onClick={() => {
                if (!snapshot) table.nextPage();
              }}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>
    </footer>
  );
}
