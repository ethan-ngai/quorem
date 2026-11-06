import { TextInput } from "./TextControl";
import { inputConstraints } from "./input-constraints";
/** @file TableControls.tsx @description Shared server sorting and page controls. @module ui */
import { pageSizeSchema } from "@quorem/contracts/pagination";
import type { Column, Table } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
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
function PageSizeControl({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (size: number) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const input = useRef<HTMLInputElement>(null);
  function apply() {
    const result = pageSizeSchema.safeParse(Number(draft));
    input.current?.setCustomValidity(result.success ? "" : "Enter a positive whole number.");
    if (!result.success) {
      input.current?.reportValidity();
      return;
    }
    onChange(result.data);
    setEditing(false);
  }
  const preset = pageSizes.some((option) => option.value === String(value));
  return (
    <div className="table-page-size">
      <SelectField
        label="Rows per page"
        value={editing || !preset ? "custom" : String(value)}
        options={[...pageSizes, { value: "custom", label: "Custom…" }]}
        onChange={(next) => {
          if (next === "custom") setEditing(true);
          else {
            setEditing(false);
            setDraft(next);
            onChange(Number(next));
          }
        }}
        disabled={disabled}
      />
      {(editing || !preset) && (
        <div className="table-page-size-custom">
          <TextInput
            unstyled
            constraint={inputConstraints.integer({ min: 1, max: Number.MAX_SAFE_INTEGER })}
            ref={input}
            type="text"
            inputMode="numeric"
            min={1}
            step={1}
            required
            aria-label="Custom rows per page"
            value={draft}
            disabled={disabled}
            onChange={(event) => {
              event.currentTarget.setCustomValidity("");
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
              if (event.key === "Escape") {
                setDraft(String(value));
                setEditing(false);
              }
            }}
          />
          <Tooltip content="Apply page size">
            <button
              className="table-page-button"
              type="button"
              onClick={apply}
              aria-label="Apply page size"
              disabled={disabled}
            >
              <Check size={16} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

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
        <PageSizeControl
          key={pageSize}
          value={pageSize}
          onChange={(size) => table.setPageSize(size)}
          disabled={disabled}
        />
        <div className="table-page-navigation">
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
      </div>
    </footer>
  );
}
