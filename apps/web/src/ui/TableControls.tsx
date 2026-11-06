/** @file TableControls.tsx @description Shared server sorting and page controls. @module ui */
import type { Column, Table } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { SelectField } from "./SelectField";
import { Tooltip } from "./Tooltip";
import "./table.css";
export function TableSortHeader<T>({
  column,
  children,
  disabled,
  className,
}: {
  column: Column<T>;
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
const pageSizes = [10, 20, 50, 100].map((value) => ({
  value: String(value),
  label: `${value} per page`,
}));
export function TablePagination<T>({
  table,
  disabled = false,
}: {
  table: Table<T>;
  disabled?: boolean;
}) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const total = table.getRowCount();
  const pages = Math.max(1, table.getPageCount());
  return (
    <footer className="table-pagination">
      <span role="status">
        {total
          ? `${Math.min(pageIndex * pageSize + 1, total)}–${Math.min((pageIndex + 1) * pageSize, total)} of ${total}`
          : "0 entries"}
      </span>
      <div>
        <SelectField
          label="Rows per page"
          value={String(pageSize)}
          options={pageSizes}
          onChange={(value) => table.setPageSize(Number(value))}
          disabled={disabled}
        />
        <Tooltip content="Previous page">
          <button
            type="button"
            className="table-page-button"
            aria-label="Previous page"
            disabled={disabled || !table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
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
            disabled={disabled || !table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </footer>
  );
}
