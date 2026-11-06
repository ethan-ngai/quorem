/** @file list-query.ts @description Bounded server list query validation. @module application */
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
  const number = (key: "page" | "limit", max: number) => {
    const raw = query.get(key);
    if (raw === null) return defaults[key];
    if (!/^[+]?\d+$/.test(raw)) return invalid();
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) return invalid();
    return value;
  };
  const sort = query.get("sort") || defaults.sort;
  const order = query.get("order") || defaults.order;
  if (!sorts.includes(sort as Sort) || (order !== "asc" && order !== "desc")) invalid();
  return {
    page: number("page", 10000),
    limit: number("limit", 100),
    sort: sort as Sort,
    order: order as "asc" | "desc",
  };
}
