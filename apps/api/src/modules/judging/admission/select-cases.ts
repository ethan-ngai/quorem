import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  validateCodingCase,
  validateCodingSequence,
  validateSqlCase,
  type JsonValue,
  type QuestionProblem,
  type Signature,
} from "@quorem/questions";
import { ApplicationError } from "../../../application/error.ts";

function obj(value: JsonValue | undefined): { [key: string]: JsonValue } {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonNumber)
    throw new Error("Invalid fixture");
  return value;
}
function array(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}
function wireCase(value: JsonValue): JsonValue {
  const c = obj(value),
    out: { [key: string]: JsonValue } = { args: c.args ?? null };
  if (Array.isArray(c.calls) && c.calls.length) out.calls = c.calls;
  if (c.expected !== undefined) out.expected = c.expected;
  return out;
}
function validationCase(value: JsonValue): JsonValue {
  const input = obj(value),
    result = { ...input };
  if (result.args === null || result.args === undefined) result.args = [];
  if (Array.isArray(result.calls))
    result.calls = result.calls.map((call) => {
      const entry = { ...obj(call) };
      if (entry.args === null || entry.args === undefined) entry.args = [];
      return entry;
    });
  return result;
}
/** Compile only the admitted stage and validate custom cases with the shared question rules. */
export function selectExecutionCases(
  fixtureRaw: string,
  kind: "run" | "submit",
  level: number,
  custom: string[] | null,
  fallback = false,
): string {
  const fixture = obj(parseLosslessJson(fixtureRaw)),
    problem = obj(fixture.problem);
  const metadata = JSON.parse(stringifyLosslessJson(problem)) as QuestionProblem;
  const stages = metadata.odyssey?.levels ?? [];
  let examples: JsonValue[] = array(problem.examples),
    tests: JsonValue[] = array(fixture.hiddenCases),
    methods: Signature[] = [];
  if (stages.length) {
    if (level < 1 || level > stages.length)
      throw new ApplicationError(
        "revision_conflict",
        "Odyssey level changed; reload progress",
        409,
      );
    const rawLevels = array(obj(problem.odyssey).levels);
    examples = rawLevels.slice(0, level).flatMap((stage) => array(obj(stage).examples));
    methods = stages.slice(0, level).flatMap((stage) => stage.methods);
    const suites = array(fixture.odysseyHiddenCases);
    if (kind === "submit" && suites.length !== stages.length)
      throw new Error("Invalid private suites");
    tests = suites.slice(0, level).flatMap(array);
  }
  const cases = custom
    ? custom.map(parseLosslessJson)
    : kind === "run" || (fallback && !tests.length)
      ? examples.map(wireCase)
      : tests.map(wireCase);
  if (fallback && !cases.length)
    throw new ApplicationError("invalid_input", "No tests configured", 400);
  const configured = metadata.limits?.maxCollectionElements ?? 10000;
  const limit =
    Number.isInteger(configured) && configured > 0 && configured <= 100000 ? configured : 10000;
  try {
    for (const value of cases) {
      const raw = stringifyLosslessJson(validationCase(value)),
        required = false;
      if (metadata.sql) validateSqlCase(metadata.sql, raw, required);
      else if (methods.length)
        validateCodingSequence(
          metadata.signature,
          metadata.constraints ?? [],
          methods,
          raw,
          required,
          limit,
        );
      else validateCodingCase(metadata.signature, metadata.constraints ?? [], raw, required, limit);
    }
  } catch (error) {
    throw new ApplicationError(
      "invalid_input",
      error instanceof Error ? error.message : "Invalid execution cases",
      400,
    );
  }
  return stringifyLosslessJson(cases);
}
