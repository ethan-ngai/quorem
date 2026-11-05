/** @file editorial.test.ts @description Approach-owned metadata, canonical references and language fallback. @module questions */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  withCanonicalApproach,
  blankApproach,
  approachCode,
  approachTitle,
  canonicalCode,
  selectApproach,
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
const publish = (content: QuestionContent) =>
  validateQuestionPublication(JSON.stringify(content), validateQuestionSchema, runtime);
it("publishes code-only language variants with one metadata owner", () => {
  const content = example();
  content.implementations.push({ ...content.implementations[0]!, language: "java" });
  content.approaches[0]!.implementations.push({ language: "java", source: "class Solution {}" });
  expect(() => publish(content)).not.toThrow();
  expect(canonicalCode(content)?.language).toBe("python");
  expect(approachCode(content.approaches[0]!, "java")?.language).toBe("java");
  expect(approachCode(content.approaches[0]!, "ocaml")?.language).toBe("python");
});
it("allows an unnamed canonical approach; alternatives need names and unique IDs", () => {
  const content = example();
  delete content.approaches[0]!.title;
  expect(() => publish(content)).not.toThrow();
  expect(approachTitle(content.approaches[0]!, content.canonicalApproachId)).toBe("Solution");
  const alt = { ...content.approaches[0]!, id: "brute-force", title: "" };
  content.approaches.push(alt);
  expect(() => publish(content)).toThrow("name required");
  alt.title = "Brute force";
  expect(() => publish(content)).not.toThrow();
  alt.id = content.canonicalApproachId;
  expect(() => publish(content)).toThrow("unique approach");
});
it("requires canonical Python, valid defaults, supported code and no metadata overrides", () => {
  const content = example();
  content.approaches[0]!.implementations = [];
  expect(() => publish(content)).toThrow("python canonical solution required");
  content.approaches[0] = blankApproach();
  content.approaches[0].implementations[0]!.source = "pass";
  content.approaches[0].defaultLanguage = "java";
  expect(() => publish(content)).toThrow("default language");
  content.approaches[0].defaultLanguage = "python";
  content.approaches[0].implementations.push({ language: "java", source: "code" });
  expect(() => publish(content)).toThrow("supported approach language");
  content.approaches[0].implementations.pop();
  Object.assign(content.approaches[0].implementations[0]!, { timeComplexity: "O(n)" });
  expect(() => publish(content)).toThrow();
});
it("bounds source and selects approaches independently from workspace language", () => {
  const content = example();
  canonicalCode(content)!.source = "bad\0source";
  expect(() => validateQuestionDraft(content)).toThrow("NUL");
  canonicalCode(content)!.source = "x".repeat(65537);
  expect(() => validateQuestionDraft(content)).toThrow("65536");
  const first = blankApproach(),
    second = blankApproach("java", "sorting");
  expect(selectApproach([second, first], undefined, "default")).toBe(first);
  expect(selectApproach([first, second], "sorting", "default")).toBe(second);
  expect(approachCode(second, "ocaml")?.language).toBe("java");
});

it("switches canonical reference without duplicating source or leaving an unnamed alternative", () => {
  const content = example();
  const alternative = { ...content.approaches[0]!, id: "sorting", title: "Sorting" };
  content.approaches.push(alternative);
  const changed = withCanonicalApproach(content, "sorting");
  expect(changed.canonicalApproachId).toBe("sorting");
  expect(changed.approaches[0]!.title).toBe("Solution");
  expect(() => publish(changed)).not.toThrow();
  expect(content.canonicalApproachId).toBe("default");
  expect(() => withCanonicalApproach(content, "missing")).toThrow("code required");
});
