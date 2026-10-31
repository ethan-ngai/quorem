import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  normalizeQuestionDraft,
  validateQuestionSchema,
  validateQuestionPublication,
  normalizeQuestionJson,
} from "../src/index.ts";
const fixture = readFileSync(
  new URL("../../contracts/questions/example-v1.json", import.meta.url),
  "utf8",
);
it("validates generated publication schema and bounded draft defaults", () => {
  expect(() => validateQuestionSchema(fixture)).not.toThrow();
  const draft = JSON.parse(
    normalizeQuestionDraft(
      '{"problem":{},"hiddenCases":[],"attribution":"","implementations":[],"solutions":[]}',
    ),
  );
  expect(draft.problem.signature.className).toBe("Solution");
  expect(draft.problem.limits.wallTimeMs).toBe(2000);
  expect(() => normalizeQuestionDraft('{"problem":{"unknown":1}}')).toThrow();
  expect(
    normalizeQuestionDraft('{"problem":{},"hiddenCases":[{"args":[9007199254740993]}]}'),
  ).toContain("9007199254740993");
});
it("keeps case numbers lossless and validates metadata separately", () => {
  const content = JSON.parse(fixture);
  content.problem.sql = {
    dialect: "postgresql",
    outputOrder: "ordered",
    tables: [{ name: "t", columns: [{ name: "n", type: "numeric" }] }],
    output: [{ name: "n", type: "numeric" }],
  };
  content.problem.constraints = [];
  content.problem.examples = [
    { args: [{ tables: [{ name: "t", rows: [[1]] }] }], expected: { rows: [[{ $numeric: "1" }]] } },
  ];
  content.hiddenCases = content.problem.examples;
  content.implementations = [
    {
      language: "postgresql",
      starterSource: "select 1",
      runtimeRevision: "pg",
      harnessRevision: "h",
      referenceSource: "select 1",
    },
  ];
  content.solutions = [];
  const raw = JSON.stringify(content).replace('"rows":[[1]]', '"rows":[[1e309]]');
  expect(() =>
    validateQuestionPublication(raw, validateQuestionSchema, () => ({
      revision: "pg",
      harness: "h",
    })),
  ).not.toThrow();
  expect(() => normalizeQuestionJson("int", "2147483648")).toThrow();
  const invalid = raw.replace('"wallTimeMs":2000', '"wallTimeMs":1e309');
  expect(() =>
    validateQuestionPublication(invalid, validateQuestionSchema, () => ({
      revision: "pg",
      harness: "h",
    })),
  ).toThrow();
});
