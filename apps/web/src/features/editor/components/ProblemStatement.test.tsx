/** @file ProblemStatement.test.tsx @description Public inputs retain their declared argument names. @module editor */
import type { ProblemVersion } from "@quorem/contracts";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { exampleInput, ProblemStatement } from "./ProblemStatement";

describe("named public example inputs", () => {
  it("pairs multiple arguments with declared parameter names in order", () => {
    const problem = {
      signature: { parameters: [{ name: "nums" }, { name: "target" }] },
    } as ProblemVersion;
    expect(exampleInput(problem, [[2, 7, 11, 15], 9])).toBe("nums = [2,7,11,15], target = 9");
  });
});

describe("topic disclosure", () => {
  it("starts hidden and connects the eye control to the topic list", () => {
    const problem = {
      id: "problem",
      title: "A problem",
      difficulty: "easy",
      tags: ["Arrays"],
      statementMarkdown: "Return the answer.",
      examples: [],
      constraints: [],
      signature: { parameters: [] },
    } as unknown as ProblemVersion;
    const markup = renderToStaticMarkup(<ProblemStatement problem={problem} />);
    expect(markup).toContain('aria-label="Show topics"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('data-visible="false" aria-hidden="true"');
    const region = markup.match(/aria-controls="([^"]+)"/)?.[1];
    expect(region).toBeTruthy();
    expect(markup).toContain(`id="${region}" class="topic-list"`);
  });
});
