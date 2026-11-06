/** @file list-query.ts @description Bounded server list query validation. @module application */
import { pageSizeSchema } from "@quorem/contracts/pagination";
import { ApplicationError } from "./error.ts";
export type ListQuery<Sort extends string = string> = {
  page: number;
  limit: number;
  sort: Sort;
  order: "asc" | "desc";
};
export function parseListQuery<Sort extends string>(
  query: URLSearchParams,
  sorts: readonly Sort[],
  defaults: ListQuery<Sort>,
): ListQuery<Sort> {
  const invalid = () => {
    throw new ApplicationError("invalid_input", "Invalid list query", 400);
  };
  for (const key of ["page", "limit", "sort", "order"]) if (query.getAll(key).length > 1) invalid();
  const number = (key: "page" | "limit", max = Number.MAX_SAFE_INTEGER) => {
    const raw = query.get(key);
    if (raw === null) return defaults[key];
    if (!/^[+]?\d+$/.test(raw)) return invalid();
    const parsed = pageSizeSchema.safeParse(Number(raw));
    if (!parsed.success || parsed.data > max) return invalid();
    return parsed.data;
  };
  const sort = query.get("sort") || defaults.sort;
  const order = query.get("order") || defaults.order;
  if (!sorts.includes(sort as Sort) || (order !== "asc" && order !== "desc")) invalid();
  return {
    page: number("page", 10000),
    limit: number("limit"),
    sort: sort as Sort,
    order: order as "asc" | "desc",
  };
}
