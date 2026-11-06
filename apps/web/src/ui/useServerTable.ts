/** @file useServerTable.ts @description Controlled TanStack state for server-owned lists. @module ui */
import { useEffect } from "react";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type PaginationState,
  type Updater,
} from "@tanstack/react-table";
export type ListState<Sort extends string = string> = {
  page: number;
  limit: number;
  sort: Sort;
  order: "asc" | "desc";
};
export function resolveUpdate<T>(update: Updater<T>, value: T): T {
  return typeof update === "function" ? (update as (previous: T) => T)(value) : update;
}
/** Server rows are already ordered and sliced; never apply client row transforms. */
export function useServerTable<T, Sort extends string>({
  data,
  columns,
  total,
  loading = false,
  state,
  onChange,
}: {
  data: T[];
  columns: ColumnDef<T>[];
  total?: number;
  loading?: boolean;
  state: ListState<Sort>;
  onChange: (state: ListState<Sort>) => void;
}) {
  useEffect(() => {
    if (loading || total === undefined) return;
    const page = Math.max(1, Math.ceil(total / state.limit));
    if (state.page > page) onChange({ ...state, page });
  }, [loading, total, state.page, state.limit, onChange]);
  const pagination = { pageIndex: state.page - 1, pageSize: state.limit };
  const sorting = [{ id: state.sort, desc: state.order === "desc" }];
  return useReactTable({
    data,
    columns,
    rowCount: total ?? 0,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    sortDescFirst: false,
    state: { pagination, sorting },
    onPaginationChange: (update: Updater<PaginationState>) => {
      const next = resolveUpdate(update, pagination);
      onChange({
        ...state,
        page: next.pageSize !== state.limit ? 1 : next.pageIndex + 1,
        limit: next.pageSize,
      });
    },
    onSortingChange: (update: Updater<SortingState>) => {
      const next = resolveUpdate(update, sorting)[0];
      if (next)
        onChange({ ...state, page: 1, sort: next.id as Sort, order: next.desc ? "desc" : "asc" });
    },
  });
}
