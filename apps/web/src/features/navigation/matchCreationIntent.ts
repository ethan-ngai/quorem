export function practiceSearch(search: Record<string, unknown>): { create?: "match" } {
  return search.create === "match" ? { create: "match" } : {};
}

export function isMatchCreationRequest(pathname: string, search: Record<string, unknown>) {
  return pathname === "/practice" && search.create === "match";
}
