/** @file QuestionFields.test.tsx @description Incomplete metadata and private content never enter public preview. @module admin */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { blankQuestion } from "./content";
import { PublicPreview, validJSONShape } from "./QuestionFields";

it("rejects malformed typed structures before preview", () => {
  expect(validJSONShape("Typed signature", null)).toBe(false);
  expect(validJSONShape("Typed signature", { parameters: [] })).toBe(false);
  expect(validJSONShape("Hidden cases (20 required)", [{ args: "wrong" }])).toBe(false);
  expect(validJSONShape("Structured constraints", [{ kind: "range" }])).toBe(false);
  expect(validJSONShape("Typed signature", blankQuestion().problem.signature)).toBe(true);
});

it("public preview excludes private reference code and hidden inputs", () => {
  const content = blankQuestion();
  content.problem.title = "Public title";
  content.problem.statementMarkdown = "Public statement";
  content.hiddenCases = [{ args: ["PRIVATE_INPUT"], expected: "PRIVATE_EXPECTATION" }];
  content.implementations[0]!.referenceSource = "PRIVATE_REFERENCE";
  content.solutions = [
    {
      language: "python",
      source: "PUBLIC_CODE",
      explanationMarkdown: "Public explanation",
      timeComplexity: "O(n)",
      spaceComplexity: "O(1)",
      complexityNotes: "n is the input length.",
    },
  ];
  const markup = renderToStaticMarkup(<PublicPreview content={content} />);
  expect(markup).toContain("Public statement");
  expect(markup).toContain("PUBLIC_CODE");
  expect(markup).not.toContain("PRIVATE_");
});
