/** @file provenance.ts @description Derive visible expected values from the admitted case. @module judging */
import type { ExecutionSpec } from "@quorem/execution";
import {
  compareCodingCase,
  compareSqlResult,
  parseLosslessJson,
  stringifyLosslessJson,
  JsonNumber,
  type QuestionProblem,
  type JsonValue,
  type Signature,
} from "@quorem/questions";

function object(value: JsonValue): { [key: string]: JsonValue } {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonNumber)
    throw new Error("Invalid admitted case");
  return value;
}
/** Caller supplies only an actual value; public expectations are never taken from runner output. */
export function deriveResult(
  spec: ExecutionSpec,
  channel: "public" | "sample" | "private",
  ordinal: number,
  status: string,
  actual: string | undefined,
  sqlTypes: string[],
): { status: string; actual?: string; expected?: string } {
  if (
    (channel === "public" && spec.kind !== "run") ||
    (channel === "sample" && spec.kind !== "submit") ||
    (channel === "private" && (spec.kind !== "submit" || !spec.privateDetails))
  )
    throw new Error("Invalid completion channel");
  const cases = channel === "sample" ? spec.submitSamples : spec.cases;
  const input = cases[ordinal];
  if (input === undefined) throw new Error("Invalid completion ordinal");
  if (
    ![
      "accepted",
      "wrong_answer",
      "executed",
      "syntax_error",
      "runtime_error",
      "time_limit",
      "memory_limit",
      "output_limit",
      "invalid_output",
    ].includes(status)
  )
    throw new Error("Invalid case status");
  if (!["accepted", "wrong_answer", "executed"].includes(status)) return { status };
  if (actual === undefined) throw new Error("Missing actual result");
  const problem = JSON.parse(spec.problemJson) as QuestionProblem;
  const methods: Signature[] = (problem.odyssey?.levels ?? []).flatMap((level) => level.methods);
  if (problem.sql) {
    const item = object(parseLosslessJson(input));
    const compared = compareSqlResult(
      problem.sql,
      "executed",
      actual,
      item.expected === undefined ? undefined : stringifyLosslessJson(item.expected),
      sqlTypes,
    );
    return { status: compared.status, actual: compared.actual, expected: compared.expected };
  }
  return compareCodingCase(problem.signature, methods, input, "executed", actual);
}
