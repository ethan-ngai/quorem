import { describe, expect, it } from "vitest";
import { isMatchCreationRequest, practiceSearch } from "./matchCreationIntent";

describe("marketing match creation", () => {
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
