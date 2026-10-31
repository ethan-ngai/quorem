import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  validateCodingCase,
  validateCodingSequence,
  validateSqlCase,
  type JsonValue,
  type QuestionProblem,
} from "@quorem/questions";
import { ApplicationError } from "../../../application/error.ts";
function obj(value: JsonValue | undefined): { [key: string]: JsonValue } {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonNumber)
    throw new Error("Invalid fixture");
  return value;
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
/** Validate bounded custom input against the canonical problem and unlocked methods. */
export function validateExecutionCases(
  metadata: QuestionProblem,
  level: number,
  raw: readonly string[],
): void {
  const stages = metadata.odyssey?.levels ?? [];
  if (stages.length && (level < 1 || level > stages.length))
    throw new ApplicationError("revision_conflict", "Odyssey level changed; reload progress", 409);
  const methods = stages.slice(0, level).flatMap((stage) => stage.methods);
  const configured = metadata.limits?.maxCollectionElements ?? 10000;
  const limit =
    Number.isInteger(configured) && configured > 0 && configured <= 100000 ? configured : 10000;
  try {
    for (const value of raw) {
      const normalized = stringifyLosslessJson(validationCase(parseLosslessJson(value)));
      if (metadata.sql) validateSqlCase(metadata.sql, normalized, false);
      else if (methods.length)
        validateCodingSequence(
          metadata.signature,
          metadata.constraints ?? [],
          methods,
          normalized,
          false,
          limit,
        );
      else
        validateCodingCase(
          metadata.signature,
          metadata.constraints ?? [],
          normalized,
          false,
          limit,
        );
    }
  } catch (error) {
    throw new ApplicationError(
      "invalid_input",
      error instanceof Error ? error.message : "Invalid execution cases",
      400,
    );
  }
}
