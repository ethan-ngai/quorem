import { describe, expect, it } from "vitest";
import { addFilter, catalogSearch } from "./catalogSearch";

describe("practice URL state", () => {
  it("adds without replacing or duplicating selected filters", () => {
    expect(addFilter("easy", "medium")).toBe("easy,medium");
    expect(addFilter("easy,medium", "easy")).toBe("easy,medium");
    expect(catalogSearch({ difficulty: "medium,easy,medium", topic: "strings,arrays" })).toEqual({
      difficulty: "easy,medium",
      topic: "arrays,strings",
    });
  });
  it("preserves valid bookmarked filters and bounded pagination", () => {
    expect(
      catalogSearch({
        q: " tree ",
        difficulty: "medium",
        topic: "tree",
        sort: "difficulty",
        order: "desc",
        page: "2",
      }),
    ).toEqual({
      q: "tree",
      difficulty: "medium",
      topic: "tree",
      sort: "difficulty",
      order: "desc",
      page: 2,
    });
  });
  it("omits defaults and rejects invalid query state", () => {
    expect(
      catalogSearch({ q: " ", difficulty: "ALL", topic: [], sort: "sql", order: "asc", page: -1 }),
    ).toEqual({});
    expect(catalogSearch({ sort: "title", page: 1 })).toEqual({});
    expect(catalogSearch({ page: 10001 })).toEqual({});
  });
  it("bounds Unicode search length without splitting characters", () => {
    expect(Array.from(catalogSearch({ q: "😀".repeat(121) }).q!)).toHaveLength(120);
    expect(Array.from(catalogSearch({ topic: "x".repeat(90) }).topic!)).toHaveLength(80);
  });
});

it("retains an explicit private library filter and rejects unknown libraries", () => {
  expect(catalogSearch({ library: "private" })).toMatchObject({ library: "private" });
  expect(catalogSearch({ library: "someone-else" })).not.toHaveProperty("library");
});

it("preserves known question types and rejects unknown types", () => {
  for (const type of ["classic", "odyssey"]) expect(catalogSearch({ type })).toEqual({ type });
  expect(catalogSearch({ type: "other" })).not.toHaveProperty("type");
});
