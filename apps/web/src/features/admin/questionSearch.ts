/** @file questionSearch.ts @description Bookmarkable question dashboard filters. @module admin */
import { catalogSearch, type CatalogSearch } from "../practice/catalogSearch";

export type QuestionSearch = Pick<
  CatalogSearch,
  "q" | "sql" | "type" | "difficulty" | "topic" | "company"
> & {
  section: "drafts" | "publications";
  source?: "leetcode" | "other";
  draft?: string;
  publication?: string;
  readiness?: "ready" | "needs-fixes";
};

export function questionSearch(raw: Record<string, unknown>): QuestionSearch {
  const { sql, type, difficulty, topic, company } = catalogSearch(raw);
  const uuid = (value: unknown) =>
    typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
      ? value
      : undefined;
  const publication = uuid(raw.publication);
  return {
    publication,
    draft: publication ? undefined : uuid(raw.draft),
    q: typeof raw.q === "string" && raw.q ? Array.from(raw.q).slice(0, 120).join("") : undefined,
    sql,
    type,
    difficulty,
    topic,
    company,
    section: raw.section === "drafts" ? "drafts" : "publications",
    source: raw.source === "leetcode" || raw.source === "other" ? raw.source : undefined,
    readiness:
      raw.readiness === "ready" || raw.readiness === "needs-fixes" ? raw.readiness : undefined,
  };
}
