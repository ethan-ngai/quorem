/** @file PracticeBrowser.test.ts @description Catalog filtering and sort behavior. @module practice */
import type { ProblemVersion } from "@quorem/contracts";
import { describe, expect, it } from "vitest";
import { filterProblems } from "./PracticeBrowser";

const problems = [
  {
    id: "1",
    slug: "tree-depth",
    title: "Tree Depth",
    difficulty: "easy",
    tags: ["tree", "recursion"],
  },
  { id: "2", slug: "array-route", title: "Array Route", difficulty: "hard", tags: ["array"] },
  { id: "3", slug: "tree-path", title: "Tree Path", difficulty: "medium", tags: ["tree"] },
] as ProblemVersion[];

describe("practice catalog", () => {
  it("combines text, difficulty and authoritative topic filters", () => {
    expect(
      filterProblems(problems, " TREE ", "medium", "tree", "title", false).map((p) => p.slug),
    ).toEqual(["tree-path"]);
    expect(
      filterProblems(problems, "recursion", "all", "all", "title", false).map((p) => p.slug),
    ).toEqual(["tree-depth"]);
    expect(filterProblems(problems, "", "hard", "tree", "title", false)).toEqual([]);
  });
  it("sorts difficulties by rank and reverses title order without mutating the catalog", () => {
    expect(
      filterProblems(problems, "", "all", "all", "difficulty", false).map((p) => p.difficulty),
    ).toEqual(["easy", "medium", "hard"]);
    expect(filterProblems(problems, "", "all", "all", "title", true).map((p) => p.title)).toEqual([
      "Tree Path",
      "Tree Depth",
      "Array Route",
    ]);
    expect(problems[0]?.slug).toBe("tree-depth");
  });
  it("uses a title tie-break for difficulty sorting", () => {
    const sameDifficulty = problems.map((problem) => ({ ...problem, difficulty: "easy" as const }));
    expect(
      filterProblems(sameDifficulty, "", "all", "all", "difficulty", false).map((p) => p.title),
    ).toEqual(["Array Route", "Tree Depth", "Tree Path"]);
  });
});
