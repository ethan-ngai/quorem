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
