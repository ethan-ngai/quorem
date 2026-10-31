/** @file draft.ts @description Bounded authoring draft rules. @module questions */
import type { QuestionContent } from "./model";

const bytes = (value: string) => new TextEncoder().encode(value).length;
const invalidUnicode = (value: string) =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const validSource = (source: string) =>
  bytes(source) <= 65536 && !source.includes("\0") && !invalidUnicode(source);
const hasNul = (value: unknown): boolean =>
  typeof value === "string"
    ? value.includes("\0")
    : Array.isArray(value)
      ? value.some(hasNul)
      : value !== null && typeof value === "object"
        ? Object.entries(value).some(([key, item]) => key.includes("\0") || hasNul(item))
        : false;

/** Validate bounded draft content; completeness and cases are separate concerns. */
export function validateQuestionDraft(content: QuestionContent): void {
  const json = JSON.stringify(content).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  if (bytes(json) > 2 * 1024 * 1024) throw new Error("question content exceeds 2 MiB");
  const p = content.problem;
  if (
    p.tags.length > 32 ||
    (p.companies?.length ?? 0) > 64 ||
    p.examples.length > 20 ||
    p.constraints.length > 64 ||
    content.hiddenCases.length > 100 ||
    content.implementations.length > 4 ||
    content.solutions.length > 4 ||
    p.signature.parameters.length > 16
  )
    throw new Error("question collection limit exceeded");
  if (
    bytes(p.id) > 64 ||
    bytes(p.version) > 32 ||
    bytes(p.slug) > 80 ||
    bytes(p.title) > 160 ||
    bytes(p.statementMarkdown) > 65536 ||
    bytes(content.attribution) > 2048
  )
    throw new Error("question text limit exceeded");
  if (
    p.sql &&
    [
      p.examples.map(({ args, expected, calls }) => ({ args, expected, calls })),
      content.hiddenCases,
      p.odyssey?.levels.flatMap((l) =>
        l.examples.map(({ args, expected, calls }) => ({ args, expected, calls })),
      ),
      content.odysseyHiddenCases,
    ].some(hasNul)
  )
    throw new Error("SQL text cannot contain NUL characters");
  if (
    p.leetcodeId != null &&
    (!Number.isInteger(p.leetcodeId) || p.leetcodeId < 1 || p.leetcodeId > 2147483647)
  )
    throw new Error("invalid LeetCode ID");
  const companies = new Set<string>();
  for (const company of p.companies ?? []) {
    const key = company.toLowerCase();
    if (
      company !== company.trim() ||
      !company ||
      bytes(company) > 80 ||
      company.includes(",") ||
      companies.has(key)
    )
      throw new Error("invalid or duplicate company");
    companies.add(key);
  }
  for (const example of p.examples)
    if (bytes(example.explanation ?? "") > 8192)
      throw new Error("example explanation limit exceeded");
  for (const c of p.constraints)
    if (c.kind === "prose" && bytes(c.text) > 4096)
      throw new Error("constraint text limit exceeded");
  for (const v of content.implementations) {
    if (!validSource(v.starterSource) || !validSource(v.referenceSource))
      throw new Error(
        "language source must be valid UTF-8, at most 65536 bytes, and contain no NUL characters",
      );
    if (bytes(v.runtimeRevision) > 128 || bytes(v.harnessRevision) > 128)
      throw new Error("language revision limit exceeded");
  }
  for (const v of content.solutions) {
    if (!validSource(v.source))
      throw new Error(
        "editorial source must be valid UTF-8, at most 65536 bytes, and contain no NUL characters",
      );
    if (
      bytes(v.explanationMarkdown) > 65536 ||
      bytes(v.timeComplexity) > 256 ||
      bytes(v.spaceComplexity) > 256 ||
      bytes(v.complexityNotes) > 4096
    )
      throw new Error("editorial text limit exceeded");
  }
}
