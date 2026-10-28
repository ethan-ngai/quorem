export type CatalogSearch = {
  sql?: "true";
  type?: "classic" | "odyssey";
  library?: "private" | "global";
  q?: string;
  difficulty?: string;
  topic?: string;
  company?: string;
  sort?: "difficulty";
  order?: "desc";
  page?: number;
};

/** Normalize bookmark state to the API's bounded query contract. */
export function catalogSearch(search: Record<string, unknown>): CatalogSearch {
  const result: CatalogSearch = {};
  if (search.sql === "true") result.sql = "true";
  if (search.type === "classic" || search.type === "odyssey") result.type = search.type;
  if (search.library === "private" || search.library === "global") result.library = search.library;
  if (typeof search.q === "string" && search.q.trim())
    result.q = Array.from(search.q.trim()).slice(0, 120).join("");
  const difficulties = filterValues(
    typeof search.difficulty === "string" ? search.difficulty : undefined,
  ).filter((value) => ["easy", "medium", "hard"].includes(value));
  if (difficulties.length) result.difficulty = difficulties.join(",");
  const topics = filterValues(typeof search.topic === "string" ? search.topic : undefined).map(
    (value) => Array.from(value).slice(0, 80).join(""),
  );
  if (topics.length) result.topic = [...new Set(topics)].join(",");
  const companies = filterValues(
    typeof search.company === "string" ? search.company : undefined,
  ).map((value) => Array.from(value).slice(0, 80).join(""));
  if (companies.length) result.company = companies.join(",");
  if (search.sort === "difficulty") result.sort = "difficulty";
  if (search.order === "desc") result.order = "desc";
  const page = Number(search.page);
  if (Number.isInteger(page) && page > 1 && page <= 10000) result.page = page;
  return result;
}

export function filterValues(value?: string): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ]
    .slice(0, 16)
    .sort();
}
export function addFilter(value: string | undefined, addition: string): string {
  return filterValues([...(value ? filterValues(value) : []), addition].join(",")).join(",");
}
