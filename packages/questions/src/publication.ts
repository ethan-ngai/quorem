/** @file publication.ts @description Definition and publication semantics over raw question JSON. @module questions */
import { compileGraphCase, graphParameters } from "./graph.ts";
import { generateQuestionImplementations } from "./starter.ts";
import { validSource } from "./source.ts";
import { canonicalCode } from "./editorial.ts";
import type { QuestionContent, Signature } from "./model.ts";
import { validateQuestionDraft } from "./draft.ts";
import { primarySignature, validateSignature } from "./signature.ts";
import { validateConstraints } from "./constraints.ts";
import { validateCodingCase, validateCodingSequence } from "./coding-case.ts";
import { validateSqlCase, validateSqlSchema } from "./sql-case.ts";
import { JsonNumber, parseLosslessJson, stringifyLosslessJson, type JsonValue } from "./json.ts";
import { QuestionFieldError, validateField } from "./validation-error.ts";

export type SchemaValidator = (rawJson: string) => void;
export type RuntimeResolver = (
  language: string,
) => { revision: string; harness: string } | undefined;
function object(value: JsonValue | undefined): { [key: string]: JsonValue } {
  if (!value || typeof value !== "object" || value instanceof JsonNumber || Array.isArray(value))
    throw new Error("invalid question content");
  return value;
}
function array(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}
function core(
  rawJson: string,
  validateSchema: SchemaValidator,
  requireHidden: boolean,
): QuestionContent {
  validateSchema(rawJson);
  const raw = object(parseLosslessJson(rawJson));
  const rawProblem = object(raw.problem);
  const content = JSON.parse(rawJson) as QuestionContent,
    p = content.problem;
  validateQuestionDraft(content);
  const levels = p.odyssey?.levels;
  const suites = levels?.map((level) => level.hiddenCases) ?? [];
  if ((p.sql || levels) && p.signature !== undefined)
    throw new Error(
      "Signature is derived for staged coding questions; SQL has no coding signature",
    );
  if (levels && (p.examples.length || content.hiddenCases.length))
    throw new Error("put staged examples and tests in their stages");
  if (
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(p.slug) ||
    !p.title.trim() ||
    !p.statementMarkdown.trim()
  )
    throw new Error("slug, title and statement required");
  if (!["easy", "medium", "hard"].includes(p.difficulty)) throw new Error("invalid difficulty");
  if (!content.attribution.trim()) throw new Error("attribution required");
  if (!levels && (!p.examples.length || (requireHidden && !content.hiddenCases.length)))
    throw new Error("public examples and at least one hidden case required");
  const tags = new Set<string>();
  for (const tag of p.tags) {
    if (!tag.trim() || new TextEncoder().encode(tag).length > 64 || tags.has(tag))
      throw new Error("invalid or duplicate tag");
    tags.add(tag);
  }
  if (p.sql) {
    if (p.constraints.some((c) => c.kind !== "prose" || !c.text.trim()))
      throw new Error("SQL supports informational prose only");
    validateSqlSchema(p.sql);
  } else {
    if (!levels) {
      validateField("/problem/signature", () => {
        const signature = primarySignature(p);
        validateSignature(signature, false);
        for (const [target, encoding] of Object.entries(signature.graphEncodings ?? {}))
          graphParameters(signature, target, encoding);
      });
    }
    validateField("/problem/constraints", () =>
      validateConstraints(primarySignature(p), p.constraints),
    );
  }
  const limits = p.limits;
  if (p.sql && (limits.memoryBytes < 268435456 || limits.maxProcesses < 16))
    throw new Error("PostgreSQL requires the default memory and process limits");
  for (const [n, max] of [
    [limits.wallTimeMs, 2000],
    [limits.memoryBytes, 268435456],
    [limits.outputBytes, 65536],
    [limits.maxProcesses, 16],
    [limits.maxCollectionElements, 100000],
    [limits.maxNestingDepth, 100],
  ])
    if (!Number.isSafeInteger(n) || n < 1 || n > max)
      throw new Error("execution limits exceed supported bounds");
  const limit = limits.maxCollectionElements || 10000;
  const signature = p.sql ? undefined : primarySignature(p);
  const requiresGraph = Object.values(signature?.graphEncodings ?? {}).some(
    ({ kind }) => kind === "custom",
  );
  const validateCase = (v: JsonValue, methods?: Signature[]) => {
    const test = object(v);
    if (p.sql || methods) {
      if (test.graphs !== undefined)
        throw new Error("Graph case authoring requires a classic coding question");
    }
    const json = stringifyLosslessJson(test);
    if (!methods && signature && (test.graphs !== undefined || requiresGraph)) {
      compileGraphCase(signature, test, limit, true);
      if (json !== stringifyLosslessJson(test))
        throw new Error("Compile graph arguments before publication");
    }
    if (p.sql) validateSqlCase(p.sql, json, true);
    else if (methods)
      validateCodingSequence(primarySignature(p), p.constraints, methods, json, true, limit);
    else validateCodingCase(primarySignature(p), p.constraints, json, true, limit);
  };
  const validateCases = (path: string, values: JsonValue[], methods?: Signature[]) => {
    values.forEach((value, index) =>
      validateField(`${path}/${index}`, () => validateCase(value, methods)),
    );
  };
  if (p.acceptance) {
    const { small, efficient, optimal } = p.acceptance;
    if (
      p.sql ||
      levels ||
      (small && small.caseCount >= efficient.caseCount) ||
      (optimal && optimal.caseCount <= efficient.caseCount) ||
      (optimal ?? efficient).caseCount !== content.hiddenCases.length
    )
      throw new QuestionFieldError(
        "/problem/acceptance",
        "Classic coding profiles must use increasing case counts and cover the full hidden suite",
      );
    for (const [name, profile] of Object.entries(p.acceptance)) {
      for (const bound of Object.values(profile.complexity)) {
        if (!/^\$?(?:O|Θ|\\Theta)\s*\([^$\r\n]+\)\$?$/.test(bound.trim()))
          throw new QuestionFieldError(
            `/problem/acceptance/${name}/complexity`,
            "Use a single time and space bound without explanatory text",
          );
      }
    }
  }
  if (levels) {
    const rawOdyssey = object(rawProblem.odyssey),
      rawLevels = array(rawOdyssey.levels),
      rawSuites = rawLevels.map((level) => object(level).hiddenCases);
    if (levels.length < 1 || levels.length > 8 || suites.length !== levels.length)
      throw new Error("Odyssey requires 1 to 8 levels with a private suite per level");
    let methods: Signature[] = [];
    const names = new Set<string>();
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i],
        suite = suites[i],
        rawLevel = object(rawLevels[i]);
      if (
        !level.title.trim() ||
        new TextEncoder().encode(level.title).length > 160 ||
        !level.statementMarkdown.trim() ||
        new TextEncoder().encode(level.statementMarkdown).length > 65536 ||
        level.examples.length < 1 ||
        level.examples.length > 20 ||
        suite.length < 1 ||
        suite.length > 20 ||
        (p.sql ? level.methods.length !== 0 : level.methods.length < 1 || level.methods.length > 16)
      )
        throw new Error(`invalid Odyssey level ${i + 1}`);
      for (const [methodIndex, method] of level.methods.entries()) {
        validateField(`/problem/odyssey/levels/${i}/methods/${methodIndex}`, () =>
          validateSignature(method, true),
        );
        if (method.graphEncodings)
          throw new Error("Graph authoring requires a classic coding question");
        if (names.has(method.methodName)) throw new Error("duplicate Odyssey method");
        names.add(method.methodName);
        methods = [...methods, method];
      }
      validateCases(`/problem/odyssey/levels/${i}/examples`, array(rawLevel.examples), methods);
      validateCases(`/problem/odyssey/levels/${i}/hiddenCases`, array(rawSuites[i]), methods);
    }
  } else {
    validateCases("/problem/examples", array(rawProblem.examples));
    validateCases("/hiddenCases", array(raw.hiddenCases));
  }
  return content;
}
/** Validate a contract-schema-checked definition; case number lexemes remain exact. */
export function validateQuestionDefinition(
  rawJson: string,
  validateSchema: SchemaValidator,
  requireHidden = false,
): void {
  core(rawJson, validateSchema, requireHidden);
}
/** Validate publication, including the execution owner's runtime revision lookup. */
export function validateQuestionPublication(
  rawJson: string,
  validateSchema: SchemaValidator,
  resolveRuntime: RuntimeResolver,
  options: { requireCanonicalSource?: boolean } = {},
): void {
  const c = core(rawJson, validateSchema, true);
  const generated = generateQuestionImplementations(c.problem, resolveRuntime);
  for (const implementation of generated)
    if (!validSource(implementation.starterSource))
      throw new Error("Generated starter exceeds execution source bounds");
  const languages = new Set<string>(generated.map((item) => item.language));
  const canonicalLanguage = c.problem.sql ? "postgresql" : "python";
  if (options.requireCanonicalSource !== false && !canonicalCode(c)?.source.trim())
    throw new QuestionFieldError(
      "/canonicalApproachId",
      `${canonicalLanguage} canonical solution required`,
    );
  if (c.approaches.length && !c.approaches.some((item) => item.id === c.canonicalApproachId))
    throw new QuestionFieldError("/canonicalApproachId", "canonical approach required");
  if (!c.approaches.length && c.canonicalApproachId)
    throw new QuestionFieldError("/canonicalApproachId", "invalid canonical approach");
  const ids = new Set<string>();
  for (const [index, approach] of c.approaches.entries()) {
    const path = `/approaches/${index}`;
    const canonical = approach.id === c.canonicalApproachId;
    if (
      !/^[a-z][a-z0-9-]*$/.test(approach.id) ||
      ids.has(approach.id) ||
      (!canonical && !approach.title?.trim())
    )
      throw new QuestionFieldError(path, "unique approach ID and name required");
    ids.add(approach.id);
    const variants = new Set<string>();
    for (const [implementationIndex, implementation] of approach.implementations.entries()) {
      if (
        !languages.has(implementation.language) ||
        variants.has(implementation.language) ||
        !implementation.source.trim()
      )
        throw new QuestionFieldError(
          `${path}/implementations/${implementationIndex}`,
          "unique supported approach language and code required",
        );
      variants.add(implementation.language);
    }
    if (
      canonical
        ? approach.defaultLanguage !== undefined
        : !approach.defaultLanguage || !variants.has(approach.defaultLanguage)
    )
      throw new QuestionFieldError(
        `${path}/defaultLanguage`,
        "valid approach default language required",
      );
  }
}
