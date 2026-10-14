export function practiceSearch(search: Record<string, unknown>): { create?: "match" } {
  return search.create === "match" ? { create: "match" } : {};
}

export function isMatchCreationRequest(pathname: string, search: Record<string, unknown>) {
  return pathname === "/practice" && search.create === "match";
}

/** Back cancels creation; successful sign-in resumes it exactly once. */
export function matchSignInLocation(path: string) {
  const source = new URL(path, "https://quorem.invalid");
  source.searchParams.delete("create");
  const backTo = source.pathname + source.search + source.hash;
  const resume = new URL(source.pathname === "/practice" ? backTo : "/practice", source.origin);
  resume.searchParams.set("create", "match");
  const query = new URLSearchParams({
    returnTo: resume.pathname + resume.search,
    backTo,
  });
  return { login: `/login?${query}`, backTo };
}
