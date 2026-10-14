export type CatalogSearch = {
  q?: string;
  difficulty?: "easy" | "medium" | "hard";
  topic?: string;
  sort?: "difficulty";
  order?: "desc";
  page?: number;
};

/** Normalize bookmark state to the API's bounded query contract. */
export function catalogSearch(search: Record<string, unknown>): CatalogSearch {
  const result: CatalogSearch = {};
  if (typeof search.q === "string" && search.q.trim())
    result.q = Array.from(search.q.trim()).slice(0, 120).join("");
  if (["easy", "medium", "hard"].includes(String(search.difficulty)))
    result.difficulty = search.difficulty as CatalogSearch["difficulty"];
  if (typeof search.topic === "string" && search.topic.trim())
    result.topic = Array.from(search.topic.trim()).slice(0, 80).join("");
  if (search.sort === "difficulty") result.sort = "difficulty";
  if (search.order === "desc") result.order = "desc";
  const page = Number(search.page);
  if (Number.isInteger(page) && page > 1 && page <= 10000) result.page = page;
  return result;
}
