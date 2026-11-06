import example from "../../../../../packages/contracts/questions/example-v1.json";
import { describe, expect, it } from "vitest";
import { blankQuestion } from "./content";
import { parseQuestionImport, questionImportLimit } from "./importQuestion";

describe("question JSON import", () => {
  it("imports the documented example", () => {
    expect(parseQuestionImport(JSON.stringify(example))).toEqual(example);
  });
  it("preserves private judging and editorial content", () => {
    const content = blankQuestion();
    content.hiddenCases = [{ args: [42], expected: 42 }];
    content.approaches[0]!.implementations[0]!.source = "canonical reference";
    expect(parseQuestionImport(JSON.stringify(content))).toEqual(content);
  });
  it("imports SQL tables, numeric results, and method-free stages", () => {
    const content = blankQuestion();
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
    expect(parseQuestionImport(JSON.stringify(content))).toEqual(content);
  });
  it.each(["{", "null", "[]", "{}", '{"problem":null}'])(
    "rejects malformed content: %s",
    (text) => {
      expect(() => parseQuestionImport(text)).toThrow();
    },
  );
  it("rejects malformed nested structures and unknown fields", () => {
    const content = blankQuestion();
    expect(() =>
      parseQuestionImport(JSON.stringify({ ...content, hiddenCases: [{ args: "bad" }] })),
    ).toThrow(/hiddenCases/);
    expect(() => parseQuestionImport(JSON.stringify({ ...content, unknown: true }))).toThrow(
      /additional properties/,
    );
  });
  it("rejects obsolete duplicate solution ownership", () => {
    const content = blankQuestion();
    expect(() => parseQuestionImport(JSON.stringify({ ...content, solutions: [] }))).toThrow(
      /additional properties/,
    );
    expect(() =>
      parseQuestionImport(
        JSON.stringify({ ...content, implementations: [{ language: "python" }] }),
      ),
    ).toThrow(/additional properties/);
  });
  it("bounds uploaded bytes", () => {
    expect(() => parseQuestionImport(" ".repeat(questionImportLimit + 1))).toThrow(/2 MiB/);
  });
});
