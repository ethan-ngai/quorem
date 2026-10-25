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

it("renders structured mathematics and literal prose with named examples", () => {
  const problem = {
    id: "math",
    title: "Bounded values",
    difficulty: "easy",
    tags: [],
    statementMarkdown: "Return the first value.",
    signature: { parameters: [{ name: "values", type: "list<int>" }], returnType: "int" },
    examples: [{ args: [[3, 4]], expected: 3, explanation: "The first value is 3." }],
    constraints: [
      { kind: "range", target: { parameter: "values", projection: "length" }, min: 1, max: 10000 },
      { kind: "prose", text: "Use the supplied values." },
    ],
  } as unknown as ProblemVersion;
  const markup = renderToStaticMarkup(<ProblemStatement problem={problem} />);
  expect(markup).toContain("values = [3,4]");
  expect(markup).toContain("<code>len(values)</code>");
  expect(markup).toContain("<msup><mn>10</mn><mn>4</mn></msup>");
  expect(markup).toContain("<mo>≤</mo>");
  expect(markup).toContain("Use the supplied values.");
  expect(markup).toContain("The first value is 3.");
});

it("removes the topic control and all topic content when the host disables hints", () => {
  const problem = {
    id: "hidden-topics",
    title: "Problem",
    difficulty: "easy",
    tags: ["SECRET_TOPIC"],
    statementMarkdown: "Solve it.",
    examples: [],
    constraints: [],
    signature: { parameters: [] },
  } as unknown as ProblemVersion;
  const markup = renderToStaticMarkup(<ProblemStatement problem={problem} allowTopics={false} />);
  expect(markup).not.toContain("Show topics");
  expect(markup).not.toContain("SECRET_TOPIC");
  expect(markup).not.toContain("topic-list");
});
