/** @file questionSearch.ts @description Bookmarkable question dashboard filters. @module admin */
import { catalogSearch, type CatalogSearch } from "../practice/catalogSearch";

export type QuestionSearch = Pick<
  CatalogSearch,
  "q" | "sql" | "type" | "difficulty" | "topic" | "company"
> & {
  section: "drafts" | "publications";
  source?: "leetcode" | "other";
  readiness?: "ready" | "needs-fixes";
};

export function questionSearch(raw: Record<string, unknown>): QuestionSearch {
  const { sql, type, difficulty, topic, company } = catalogSearch(raw);
  return {
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
