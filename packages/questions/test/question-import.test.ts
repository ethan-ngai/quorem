/** @file question-import.test.ts @description Question file parity regressions. @module questions */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  decodeQuestionImport,
  questionImportReadiness,
  QuestionImportError,
} from "../src/index.ts";

const fixture = readFileSync(
  new URL("../../contracts/questions/example-v1.json", import.meta.url),
  "utf8",
);
const runtime = () => ({ revision: "fixture", harness: "fixture" });

function diagnostics(raw: string) {
  try {
    decodeQuestionImport(raw);
  } catch (error) {
    if (error instanceof QuestionImportError) return error.diagnostics;
    throw error;
  }
  throw new Error("Expected invalid import");
}

it("accepts missing editor ID and limits while preserving a legacy ID when supplied", () => {
  const content = JSON.parse(fixture);
  const id = content.problem.id;
  expect(JSON.parse(decodeQuestionImport(fixture).normalized).problem.id).toBe(id);
  delete content.problem.id;
  delete content.problem.limits;

  const { normalized, problem } = decodeQuestionImport(JSON.stringify(content));
  expect(problem).toMatchObject({ slug: content.problem.slug, title: content.problem.title });
  expect(JSON.parse(normalized).problem).toMatchObject({
    id: "00000000-0000-4000-8000-000000000000",
    limits: { wallTimeMs: 2000, maxCollectionElements: 10000 },
  });
  expect(questionImportReadiness(normalized, runtime)).toEqual([]);
});

it("reports obsolete and duplicate properties before draft normalization", () => {
  const content = JSON.parse(fixture);
  content.problem.version = "1";
  expect(diagnostics(JSON.stringify(content))).toMatchObject([
    { path: "/problem/version", code: "additionalProperties" },
  ]);
  expect(diagnostics('{"problem":{},"problem":{}}')).toMatchObject([
    { path: "/problem", code: "duplicate_key" },
  ]);
  expect(diagnostics('{"problem":{"slug":"one","sl\\u0075g":"two"}}')).toMatchObject([
    { path: "/problem/slug", code: "duplicate_key" },
  ]);
});

it("validates source IDs without rounding and preserves exact case numeric tokens", () => {
  const content = JSON.parse(fixture);
  content.problem.leetcodeId = 123;
  content.hiddenCases[0].args = [111, 222, 333];
  const raw = JSON.stringify(content).replace(
    '"args":[111,222,333]',
    '"args":[9007199254740993,1e309,-0]',
  );
  expect(decodeQuestionImport(raw).normalized).toContain('"args":[9007199254740993,1e309,-0]');
  expect(diagnostics(raw.replace('"leetcodeId":123', '"leetcodeId":123.0'))).toMatchObject([
    { path: "/problem/leetcodeId", code: "integer" },
  ]);
});

it("checks metadata NUL without changing NUL in coding case values", () => {
  const content = JSON.parse(fixture);
  content.hiddenCases[0].args = ["\0"];
  expect(decodeQuestionImport(JSON.stringify(content)).normalized).toContain('"args":["\\u0000"]');
  content.problem.title = "\0";
  expect(diagnostics(JSON.stringify(content))).toMatchObject([
    { path: "/problem/title", code: "nul" },
  ]);
});

it("reports semantic case and approach blockers with authoring paths", () => {
  const content = JSON.parse(fixture);
  content.hiddenCases[0].args = [];
  const brokenCase = decodeQuestionImport(JSON.stringify(content));
  expect(questionImportReadiness(brokenCase.normalized, runtime)).toEqual([
    { path: "/hiddenCases/0", code: "publication", message: "wrong argument count" },
  ]);

  const noCanonical = JSON.parse(fixture);
  noCanonical.canonicalApproachId = "missing";
  const brokenApproach = decodeQuestionImport(JSON.stringify(noCanonical));
  expect(questionImportReadiness(brokenApproach.normalized, runtime)).toMatchObject([
    { path: "/canonicalApproachId", code: "publication" },
  ]);
});
