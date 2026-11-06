/** @file questionSearch.test.ts @description Dashboard URL sorting and page-size contracts. @module admin */
import { expect, it } from "vitest";
import { questionSearch } from "./questionSearch";
it("preserves page size and both sort directions while bounding the active section", () => {
  expect(
    questionSearch({ section: "drafts", sort: "updatedAt", order: "asc", page: "3", limit: "50" }),
  ).toMatchObject({ section: "drafts", sort: "updatedAt", order: "asc", page: 3, limit: 50 });
  expect(
    questionSearch({ section: "publications", sort: "updatedAt", limit: "101" }),
  ).toMatchObject({ sort: undefined, limit: undefined });
  expect(questionSearch({ sort: "difficulty", order: "desc", limit: 10 })).toMatchObject({
    section: "publications",
    sort: "difficulty",
    order: "desc",
    limit: 10,
  });
});
