import { describe, expect, it } from "vitest";
import { isMatchCreationRequest, matchSignInLocation, practiceSearch } from "./matchCreationIntent";

describe("marketing match creation", () => {
  it("separates canceled back navigation from authenticated creation resumption", () => {
    const result = matchSignInLocation("/practice?create=match&q=tree");
    expect(result.backTo).toBe("/practice?q=tree");
    const params = new URL(result.login, "https://quorem.test").searchParams;
    expect(params.get("backTo")).toBe("/practice?q=tree");
    expect(params.get("returnTo")).toBe("/practice?q=tree&create=match");
    expect(matchSignInLocation("/practice/split-load").backTo).toBe("/practice/split-load");
  });
  it("admits only the explicit match intent", () => {
    expect(practiceSearch({ create: "match" })).toEqual({ create: "match" });
    expect(practiceSearch({ create: "other" })).toEqual({});
    expect(practiceSearch({})).toEqual({});
  });
  it("opens only the practice browser and stops after consuming the query", () => {
    expect(isMatchCreationRequest("/practice", { create: "match" })).toBe(true);
    expect(isMatchCreationRequest("/practice", {})).toBe(false);
    expect(isMatchCreationRequest("/practice/run-widths", { create: "match" })).toBe(false);
    expect(isMatchCreationRequest("/match/abc", { create: "match" })).toBe(false);
    expect(isMatchCreationRequest("/invite/token", { create: "match" })).toBe(false);
  });
});
