import { describe, expect, it } from "vitest";
import { catalogSearch } from "./catalogSearch";

describe("practice URL state", () => {
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
