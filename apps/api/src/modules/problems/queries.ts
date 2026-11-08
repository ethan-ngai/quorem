/** @file queries.ts @description Catalog validation and authorized query service. @module problems */
import { catalogQuery, problemId } from "@quorem/contracts/catalog-filter";
import { parseListQuery } from "../../application/list-query.ts";
import { ApplicationError } from "../../application/error.ts";
import type { CatalogFilter, ProblemActor } from "./model.ts";
import type { ProblemQueries } from "./ports.ts";
const invalid = () => new ApplicationError("invalid_input", "Invalid question filters", 400);
/** Parse catalog filters and apply the distinct Browse and Recommended page rules. */
export function parseCatalogFilter(q: URLSearchParams): CatalogFilter {
  const input = Object.fromEntries(q);
  if (Object.keys(input).length !== q.size) throw invalid();
  const parsed = catalogQuery.safeParse(input);
  if (!parsed.success) throw invalid();
  const {
    q: query,
    difficulty,
    topic,
    topicMatch,
    company,
    companyMatch,
    library,
    type,
    sql,
  } = parsed.data;
  const { page, limit, sort, order } = parseListQuery(q, ["title", "difficulty", "recommended"], {
    page: 1,
    limit: 20,
    sort: "title",
    order: "asc",
  });
  if (sort === "recommended" && (order !== "asc" || page !== 1 || limit > 20)) throw invalid();
  return {
    query,
    difficulty,
    topic,
    ...(topicMatch === "all" && { topicMatch }),
    company,
    ...(companyMatch === "all" && { companyMatch }),
    sort,
    order,
    library,
    type,
    sql,
    page,
    limit,
  };
}
/** Preserve the public not-found contract without exposing ownership. */
export async function readProblem(
  queries: ProblemQueries,
  actor: ProblemActor | undefined,
  value: string,
  byVersion: boolean,
): Promise<string> {
  if (byVersion && !problemId.safeParse(value).success)
    throw new ApplicationError("not_found", "Problem not found", 404);
  const result = byVersion
    ? await queries.byVersion(actor, value)
    : await queries.bySlug(actor, value);
  if (result === null) throw new ApplicationError("not_found", "Problem not found", 404);
  return result;
}
/** Editorial endpoints reject malformed version identifiers before querying. */
export function validateEditorialId(value: string): void {
  if (!problemId.safeParse(value).success)
    throw new ApplicationError("invalid_input", "Invalid problem ID", 400);
}
