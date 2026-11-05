/** @file editorial.test.ts @description Canonical selection and runtime-independent publication. @module questions */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  blankSolution,
  hasEditorial,
  questionEditorials,
  selectEditorial,
  validateQuestionDraft,
  validateQuestionPublication,
  validateQuestionSchema,
} from "../src/index.ts";
import type { QuestionContent } from "../src/model.ts";
const example = (): QuestionContent =>
  JSON.parse(
    readFileSync(new URL("../../contracts/questions/example-v1.json", import.meta.url), "utf8"),
  );
const runtime = () => ({ revision: "python-3.12-v1", harness: "quorem-harness-v2" });

it("publishes multiple submission languages with only one canonical source", () => {
  const content = example();
  content.implementations.push({ ...content.implementations[0]!, language: "java" });
  content.solutions = [];
  expect(() =>
    validateQuestionPublication(JSON.stringify(content), validateQuestionSchema, runtime),
  ).not.toThrow();
  expect(questionEditorials(content)).toEqual([content.canonicalSolution]);
  expect(hasEditorial(["python"], "java")).toBe(true);
});
it("requires Python canonical code and rejects duplicate or unsupported editorials", () => {
  const content = example();
  const publish = () =>
    validateQuestionPublication(JSON.stringify(content), validateQuestionSchema, runtime);
  content.canonicalSolution.language = "java";
  expect(publish).toThrow("python canonical solution required");
  content.canonicalSolution = blankSolution();
  expect(publish).toThrow("canonical solution required");
  content.canonicalSolution.source = "class Solution: pass";
  content.solutions = [{ ...content.canonicalSolution }];
  expect(publish).toThrow("editorial language and code required");
  content.solutions[0]!.language = "java";
  expect(publish).toThrow("editorial language and code required");
});
it("applies source validity to canonical code as well as optional editorials", () => {
  const content = example();
  content.canonicalSolution.source = "bad\0source";
  expect(() => validateQuestionDraft(content)).toThrow("NUL");
  content.canonicalSolution.source = "x".repeat(65537);
  expect(() => validateQuestionDraft(content)).toThrow("65536");
});
it("prefers an authored language and otherwise falls back only to the canonical language", () => {
  const python = blankSolution(),
    java = blankSolution("java");
  expect(selectEditorial([python, java], "java")).toBe(java);
  expect(selectEditorial([java, python], "ocaml")).toBe(python);
  expect(selectEditorial([java], "ocaml")).toBeUndefined();
  expect(selectEditorial([blankSolution("postgresql")], "postgresql")?.language).toBe("postgresql");
  expect(hasEditorial(undefined, "python")).toBe(false);
});
