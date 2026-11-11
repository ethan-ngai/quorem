import example from "../../../../../packages/contracts/questions/example-v1.json";
import { describe, expect, it } from "vitest";
import { blankQuestion } from "./content";
import { decodeQuestionImport, questionImportLimit } from "@quorem/questions";

function authoredQuestion() {
  const { problem, ...content } = blankQuestion();
  const { id: _id, ...authoredProblem } = problem;
  return { ...content, problem: authoredProblem };
}

describe("question JSON import", () => {
  it("imports the documented example", () => {
    expect(decodeQuestionImport(JSON.stringify(example)).problem).toMatchObject({
      slug: example.problem.slug,
      title: example.problem.title,
    });
  });
  it("preserves private judging and editorial content", () => {
    const content = authoredQuestion();
    content.problem.slug = "example-import";
    content.hiddenCases = [{ args: [42], expected: 42 }];
    content.approaches[0]!.implementations[0]!.source = "canonical reference";
    const imported = JSON.parse(decodeQuestionImport(JSON.stringify(content)).normalized);
    expect(imported.hiddenCases).toEqual(content.hiddenCases);
    expect(imported.approaches[0].implementations).toEqual(content.approaches[0]!.implementations);
  });
  it("imports SQL tables, numeric results, and method-free stages", () => {
    const content = authoredQuestion();
    content.problem.slug = "example-import";
    delete content.problem.signature;
    content.problem.sql = {
      dialect: "postgresql",
      outputOrder: "unordered",
      tables: [{ name: "items", columns: [{ name: "amount", type: "numeric" }] }],
      output: [{ name: "amount", type: "numeric" }],
    };
    const test = {
      args: [
        {
          tables: [{ name: "items", rows: [["1.250"]] }],
        },
      ],
      expected: { rows: [[{ $numeric: "1.25" }]] },
    };
    content.problem.odyssey = {
      levels: [
        {
          title: "Step 1",
          statementMarkdown: "Query",
          methods: [],
          examples: [test],
          hiddenCases: [test],
        },
      ],
    };
    expect(
      JSON.parse(decodeQuestionImport(JSON.stringify(content)).normalized).problem,
    ).toMatchObject({
      sql: content.problem.sql,
      odyssey: content.problem.odyssey,
    });
  });
  it.each(["{", "null", "[]", "{}", '{"problem":null}'])(
    "rejects malformed content: %s",
    (text) => {
      expect(() => decodeQuestionImport(text)).toThrow();
    },
  );
  it("rejects malformed nested structures and unknown fields", () => {
    const content = authoredQuestion();
    content.problem.slug = "example-import";
    expect(() =>
      decodeQuestionImport(JSON.stringify({ ...content, hiddenCases: [{ args: "bad" }] })),
    ).toThrow(/hiddenCases/);
    expect(() => decodeQuestionImport(JSON.stringify({ ...content, unknown: true }))).toThrow(
      /unknown|additional|property/i,
    );
  });
  it("rejects obsolete duplicate solution ownership", () => {
    const content = authoredQuestion();
    content.problem.slug = "example-import";
    expect(() => decodeQuestionImport(JSON.stringify({ ...content, solutions: [] }))).toThrow(
      /unknown|additional|property/i,
    );
    expect(() =>
      decodeQuestionImport(
        JSON.stringify({ ...content, implementations: [{ language: "python" }] }),
      ),
    ).toThrow(/unknown|additional|property/i);
  });
  it("bounds uploaded bytes", () => {
    expect(() => decodeQuestionImport(" ".repeat(questionImportLimit + 1))).toThrow(/2 MiB/);
  });
});
