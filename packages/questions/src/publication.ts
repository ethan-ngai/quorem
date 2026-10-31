/** @file publication.ts @description Definition and publication semantics over raw question JSON. @module questions */
import type { QuestionContent, Signature } from "./model.ts";
import { validateQuestionDraft } from "./draft.ts";
import { validateSignature } from "./signature.ts";
import { validateConstraints } from "./constraints.ts";
import { validateCodingCase, validateCodingSequence } from "./coding-case.ts";
import { validateSqlCase, validateSqlSchema } from "./sql-case.ts";
import { JsonNumber, parseLosslessJson, stringifyLosslessJson, type JsonValue } from "./json.ts";

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
function signatureIdentity(sig: Signature): string {
  return JSON.stringify({
    description: sig.description || "",
    returns: sig.returns || "",
    throws: (sig.throws ?? []).map((t) => ({ type: t.type, description: t.description })),
    outputOrder: sig.outputOrder || "",
    className: sig.className,
    methodName: sig.methodName,
    parameters: sig.parameters.map((p) => ({
      description: p.description || "",
      name: p.name,
      type: p.type,
      input: p.input
        ? {
            preset: p.input.preset,
            placeholder: p.input.placeholder ?? null,
            rows: p.input.rows ?? null,
          }
        : null,
    })),
    returnType: sig.returnType,
  });
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
  const suites = content.odysseyHiddenCases ?? [],
    levels = p.odyssey?.levels;
  if (!levels && suites.length) throw new Error("staged tests require stages");
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
    validateSignature(p.signature, !!levels);
    validateConstraints(p.signature, p.constraints);
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
  const validateCase = (v: JsonValue, methods?: Signature[]) => {
    const json = stringifyLosslessJson(v);
    if (p.sql) validateSqlCase(p.sql, json, true);
    else if (methods)
      validateCodingSequence(p.signature, p.constraints, methods, json, true, limit);
    else validateCodingCase(p.signature, p.constraints, json, true, limit);
  };
  if (levels) {
    const rawOdyssey = object(rawProblem.odyssey),
      rawLevels = array(rawOdyssey.levels),
      rawSuites = array(raw.odysseyHiddenCases);
    if (levels.length < 1 || levels.length > 8 || suites.length !== levels.length)
      throw new Error("Odyssey requires 1 to 8 levels with a private suite per level");
    if (
      !p.sql &&
      (!levels[0].methods.length ||
        signatureIdentity(p.signature) !== signatureIdentity(levels[0].methods[0]))
    )
      throw new Error("primary signature must match the first stage method");
    let methods: Signature[] = [];
    const names = new Set<string>();
    let hiddenCount = 0;
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i],
        suite = suites[i],
        rawLevel = object(rawLevels[i]);
      hiddenCount += suite.length;
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
      for (const method of level.methods) {
        validateSignature(method, true);
        if (names.has(method.methodName)) throw new Error("duplicate Odyssey method");
        names.add(method.methodName);
        methods = [...methods, method];
      }
      for (const ex of array(rawLevel.examples)) validateCase(ex, methods);
      for (const test of array(rawSuites[i])) validateCase(test, methods);
    }
    if (hiddenCount > 100) throw new Error("hidden case limit exceeded");
  } else {
    for (const ex of array(rawProblem.examples)) validateCase(ex);
    for (const test of array(raw.hiddenCases)) validateCase(test);
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
): void {
  const c = core(rawJson, validateSchema, true);
  const languages = new Set<string>();
  for (const impl of c.implementations) {
    const runtime = resolveRuntime(impl.language);
    if (
      !runtime ||
      languages.has(impl.language) ||
      runtime.revision !== impl.runtimeRevision ||
      runtime.harness !== impl.harnessRevision ||
      !impl.starterSource.trim() ||
      !impl.referenceSource.trim()
    )
      throw new Error("invalid or duplicate language implementation");
    languages.add(impl.language);
  }
  if (
    c.problem.sql
      ? languages.size !== 1 || !languages.has("postgresql")
      : !languages.has("python") || languages.has("postgresql")
  )
    throw new Error(
      c.problem.sql
        ? "SQL problems require the PostgreSQL implementation"
        : "Python implementation required for coding problems",
    );
  const editorials = new Set<string>();
  for (const solution of c.solutions) {
    if (
      !languages.has(solution.language) ||
      editorials.has(solution.language) ||
      !solution.source.trim()
    )
      throw new Error("editorial language and code required");
    editorials.add(solution.language);
  }
}
