/** @file list-query.test.ts @description List bounds and sort allowlist regression. @module application */
import { expect, it } from "vitest";
import { parseListQuery } from "./list-query.ts";
const defaults = { page: 1, limit: 20, sort: "title", order: "asc" } as const;
it("defaults and parses bounded list state", () => {
  expect(parseListQuery(new URLSearchParams(), ["title", "difficulty"], defaults)).toEqual(
    defaults,
  );
  expect(
    parseListQuery(
      new URLSearchParams("page=3&limit=137&sort=difficulty&order=desc"),
      ["title", "difficulty"],
      defaults,
    ),
  ).toEqual({ page: 3, limit: 137, sort: "difficulty", order: "desc" });
});
it("rejects ambiguous, unbounded and unrecognized list state", () => {
  for (const value of [
    "page=0",
    "page=10001",
    "page=2.5",
    "limit=0",
    "limit=-1",
    "limit=1.5",
    "limit=9007199254740992",
    "sort=source",
    "order=sideways",
    "limit=10&limit=20",
    "page=1&page=2",
    "sort=title&sort=title",
    "order=asc&order=desc",
  ])
    expect(() => parseListQuery(new URLSearchParams(value), ["title"], defaults)).toThrow();
});
