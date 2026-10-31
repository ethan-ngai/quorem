/** @file queries.ts @description Catalog validation and authorized query service. @module problems */
import { ApplicationError } from "../../application/error.ts";
import type { CatalogFilter, ProblemActor } from "./model.ts";
import type { ProblemQueries } from "./ports.ts";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () => new ApplicationError("invalid_input", "Invalid question filters", 400);
/** Parse the established catalog filters and bounded pagination. */
export function parseCatalogFilter(q: URLSearchParams): CatalogFilter {
  for (const key of [
    "q",
    "difficulty",
    "topic",
    "company",
    "sort",
    "order",
    "page",
    "limit",
    "library",
    "type",
    "sql",
    "cursor",
  ])
    if (q.getAll(key).length > 1) throw invalid();
  const query = (q.get("q") ?? "").trim(),
    difficulty = q.get("difficulty") ?? "",
    topic = q.get("topic") ?? "",
    company = q.get("company") ?? "",
    sort = q.get("sort") || "title",
    order = q.get("order") || "asc",
    library = q.get("library") ?? "",
    type = q.get("type") ?? "",
    sql = q.get("sql") ?? "";
  if (
    Array.from(query).length > 120 ||
    !["title", "difficulty"].includes(sort) ||
    !["asc", "desc"].includes(order) ||
    !["", "global", "private"].includes(library) ||
    !["", "classic", "odyssey"].includes(type) ||
    !["", "true", "false"].includes(sql)
  )
    throw invalid();
  for (const [value, isDifficulty] of [
    [difficulty, true],
    [topic, false],
    [company, false],
  ] as const)
    if (value) {
      const values = value.split(",");
      if (
        values.length > 16 ||
        values.some(
          (x) =>
            !x ||
            x.includes("\0") ||
            Array.from(x).length > 80 ||
            (isDifficulty && !["easy", "medium", "hard"].includes(x)),
        )
      )
        throw invalid();
    }
  const parse = (key: string, fallback: number, max: number) => {
    const raw = q.get(key);
    if (raw === null) return fallback;
    if (!/^[+]?\d+$/.test(raw)) throw invalid();
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw invalid();
    return value;
  };
  const page = parse("page", 1, 10000),
    limit = parse("limit", 20, 100),
    cursor = q.get("cursor") ?? undefined;
  if (cursor && (cursor.length > 32768 || page !== 1)) throw invalid();
  return {
    query,
    difficulty,
    topic,
    company,
    sort: sort as CatalogFilter["sort"],
    order: order as CatalogFilter["order"],
    library: library as CatalogFilter["library"],
    type: type as CatalogFilter["type"],
    sql: sql as CatalogFilter["sql"],
    page,
    limit,
    cursor,
  };
}
/** Preserve the public not-found contract without exposing ownership. */
export async function readProblem(
  queries: ProblemQueries,
  actor: ProblemActor | undefined,
  value: string,
  byVersion: boolean,
): Promise<string> {
  if (byVersion && !uuid.test(value))
    throw new ApplicationError("not_found", "Problem not found", 404);
  const result = byVersion
    ? await queries.byVersion(actor, value)
    : await queries.bySlug(actor, value);
  if (result === null) throw new ApplicationError("not_found", "Problem not found", 404);
  return result;
}
/** Editorial endpoints reject malformed version identifiers before querying. */
export function validateEditorialId(value: string): void {
  if (!uuid.test(value)) throw new ApplicationError("invalid_input", "Invalid problem ID", 400);
}
