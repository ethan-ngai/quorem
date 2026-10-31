/** @file completion.ts @description Private completion JSON mapping. @module execution */
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
import type { CaseResult, Completion, Diagnostic, Verdict } from "./contracts.ts";
import { decodeObject, intField, rawJson, stringField, type ObjectValue } from "./wire.ts";
const verdicts = new Set([
  "accepted",
  "wrong_answer",
  "syntax_error",
  "runtime_error",
  "time_limit",
  "memory_limit",
  "output_limit",
  "invalid_output",
]);
function object(value: JsonValue): ObjectValue {
  if (!value || typeof value !== "object" || value instanceof JsonNumber || Array.isArray(value))
    throw new Error("invalid completion object");
  return value;
}
function number(value: number): JsonNumber {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid completion integer");
  return new JsonNumber(String(value));
}
function optionalString(obj: ObjectValue, key: string): string | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new Error(`invalid ${key}`);
  return v;
}
function list(value: JsonValue | undefined): JsonValue[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("invalid completion list");
  return value;
}
function diagnostics(value: JsonValue | undefined): Diagnostic[] | undefined {
  return list(value)?.map((v) => {
    const o = object(v);
    return {
      message: stringField(o, "message"),
      line: o.line === undefined ? undefined : Number(intField(o, "line", 0n, 2147483647n)),
      column: o.column === undefined ? undefined : Number(intField(o, "column", 0n, 2147483647n)),
    };
  });
}
function cases(value: JsonValue | undefined): CaseResult[] | undefined {
  return list(value)?.map((v) => {
    const o = object(v);
    return {
      index: Number(intField(o, "index", 0n, 2147483647n)),
      status: stringField(o, "status"),
      stdout: optionalString(o, "stdout"),
      stderr: optionalString(o, "stderr"),
      sqlTypes: list(o.sqlTypes)?.map((item) => {
        if (typeof item !== "string") throw new Error("invalid sqlTypes");
        return item;
      }),
      actual: o.actual === undefined ? undefined : rawJson(o.actual),
      expected: o.expected === undefined ? undefined : rawJson(o.expected),
      diagnostics: diagnostics(o.diagnostics),
    };
  });
}
function verdict(value: string): Verdict {
  if (!verdicts.has(value)) throw new Error("invalid verdict");
  return value as Verdict;
}
/** Decode private completion payloads without rounding actual or expected JSON. */
export function decodeCompletion(json: string): Completion {
  const obj = decodeObject(json),
    score = obj.score === undefined ? undefined : object(obj.score),
    v = optionalString(obj, "verdict");
  return {
    submissionId: stringField(obj, "submissionId"),
    attemptId: stringField(obj, "attemptId"),
    verdict: v === undefined ? undefined : verdict(v),
    score: score
      ? {
          passed: Number(intField(score, "passed", 0n, 2147483647n)),
          total: Number(intField(score, "total", 0n, 2147483647n)),
        }
      : undefined,
    safeDiagnostics: diagnostics(obj.safeDiagnostics),
    publicCaseResults: cases(obj.publicCaseResults),
    submitSampleResults: cases(obj.submitSampleResults),
    privateCaseResults: cases(obj.privateCaseResults),
    hiddenCases: list(obj.hiddenCases)?.map((item) => {
      const o = object(item);
      if (Object.keys(o).some((key) => key !== "index" && key !== "status"))
        throw new Error("invalid hidden case");
      return {
        index: Number(intField(o, "index", 0n, 2147483647n)),
        status: verdict(stringField(o, "status")),
      };
    }),
    engineFailure: optionalString(obj, "engineFailure"),
  };
}
function diag(value: readonly Diagnostic[]): JsonValue {
  return value.map((d) => ({
    message: d.message,
    ...(d.line ? { line: number(d.line) } : {}),
    ...(d.column ? { column: number(d.column) } : {}),
  }));
}
function caseValues(value: readonly CaseResult[]): JsonValue {
  return value.map((c) => ({
    index: number(c.index),
    status: c.status,
    ...(c.sqlTypes?.length ? { sqlTypes: [...c.sqlTypes] } : {}),
    ...(c.stdout ? { stdout: c.stdout } : {}),
    ...(c.stderr ? { stderr: c.stderr } : {}),
    ...(c.actual !== undefined ? { actual: parseLosslessJson(c.actual) } : {}),
    ...(c.expected !== undefined ? { expected: parseLosslessJson(c.expected) } : {}),
    ...(c.diagnostics?.length ? { diagnostics: diag(c.diagnostics) } : {}),
  }));
}
/** Encode private completion fields with explicit raw JSON mapping. */
export function encodeCompletion(value: Completion): string {
  const obj: ObjectValue = { submissionId: value.submissionId, attemptId: value.attemptId };
  if (value.verdict) obj.verdict = value.verdict;
  if (value.score)
    obj.score = { passed: number(value.score.passed), total: number(value.score.total) };
  if (value.safeDiagnostics?.length) obj.safeDiagnostics = diag(value.safeDiagnostics);
  if (value.publicCaseResults?.length) obj.publicCaseResults = caseValues(value.publicCaseResults);
  if (value.submitSampleResults?.length)
    obj.submitSampleResults = caseValues(value.submitSampleResults);
  if (value.privateCaseResults?.length)
    obj.privateCaseResults = caseValues(value.privateCaseResults);
  if (value.hiddenCases?.length)
    obj.hiddenCases = value.hiddenCases.map((c) => ({
      index: number(c.index),
      status: verdict(c.status),
    }));
  if (value.engineFailure) obj.engineFailure = value.engineFailure;
  const json = stringifyLosslessJson(obj);
  decodeCompletion(json);
  return json;
}
