/** @file QuestionFields.test.tsx @description Incomplete metadata and private content never enter public preview. @module admin */
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { blankQuestion } from "./content";
import { PublicPreview, QuestionFields } from "./QuestionFields";

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

it("renders public SQL table inputs without private cases", () => {
  const content = blankQuestion();
  content.problem.sql = { dialect: "postgresql", outputOrder: "unordered" };
  content.problem.examples = [
    {
      args: [{ tables: [{ name: "public_items", columns: [], rows: [] }] }],
      expected: { columns: ["id"], rows: [] },
    },
  ];
  content.hiddenCases = [{ args: ["PRIVATE_INPUT"], expected: "PRIVATE_EXPECTATION" }];
  const markup = renderToStaticMarkup(<PublicPreview content={content} />);
  expect(markup).toContain("public_items");
  expect(markup).not.toContain("PRIVATE_");
});

it("names SQL questions by type and PostgreSQL as the dialect", () => {
  const content = blankQuestion();
  content.problem.sql = { dialect: "postgresql", outputOrder: "unordered" };
  const html = renderToStaticMarkup(
    <QuestionFields
      content={content}
      disabled={false}
      onChange={() => {}}
      onValidityChange={() => {}}
    />,
  );
  expect(html).toContain("SQL question");
  expect(html).toContain('aria-label="SQL dialect"');
  expect(html).toContain("postgresql.svg");
  expect(html).not.toContain("PostgreSQL question");
});
