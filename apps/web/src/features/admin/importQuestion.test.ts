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
    content.implementations[0]!.referenceSource = "private reference";
    expect(parseQuestionImport(JSON.stringify(content))).toEqual(content);
  });
  it("imports SQL tables, numeric results, and method-free stages", () => {
    const content = blankQuestion();
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
      levels: [{ title: "Step 1", statementMarkdown: "Query", methods: [], examples: [test] }],
    };
    content.odysseyHiddenCases = [[test]];
    content.implementations = [
      {
        language: "postgresql",
        starterSource: "SELECT amount FROM items",
        runtimeRevision: "postgresql-17.6-v1",
        harnessRevision: "quorem-postgresql-v2",
        referenceSource: "SELECT amount FROM items",
      },
    ];
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
  it("bounds uploaded bytes", () => {
    expect(() => parseQuestionImport(" ".repeat(questionImportLimit + 1))).toThrow(/2 MiB/);
  });
});
