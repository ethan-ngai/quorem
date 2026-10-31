/** @file coding-case.ts @description Coding cases, constraints and sequence results. @module questions */
import type { Constraint, ConstraintTarget, Signature } from "./model.ts";
import { validateConstraints } from "./constraints.ts";
import {
  compareUtf8,
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "./json.ts";
import { normalizeQuestionValue } from "./value-codec.ts";

type JsonObject = { [key: string]: JsonValue };
function object(value: JsonValue): JsonObject {
  if (!value || Array.isArray(value) || typeof value !== "object" || value instanceof JsonNumber)
    throw new Error("expected object");
  return value;
}
function rawCase(sig: Signature, data: JsonObject, required: boolean, limit: number): JsonValue[] {
  if (!Array.isArray(data.args) || data.args.length !== sig.parameters.length)
    throw new Error("wrong argument count");
  const args = data.args.map((arg, i) => {
    try {
      return normalizeQuestionValue(sig.parameters[i].type, arg, limit);
    } catch (error) {
      throw new Error(
        `argument ${sig.parameters[i].name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  if (Object.hasOwn(data, "expected")) {
    try {
      normalizeQuestionValue(sig.returnType, data.expected);
    } catch (error) {
      throw new Error(`expected: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (required) throw new Error("missing expected value");
  return args;
}
function applyConstraints(
  sig: Signature,
  constraints: readonly Constraint[],
  args: JsonValue[],
): void {
  validateConstraints(sig, constraints);
  const project = (target: ConstraintTarget): number[] => {
    const value = args[sig.parameters.findIndex((p) => p.name === target.parameter)];
    if (target.projection === "length")
      return [typeof value === "string" ? Array.from(value).length : (value as JsonValue[]).length];
    if (target.projection === "value")
      return typeof value === "string"
        ? Array.from(value).map((c) => c.codePointAt(0)!)
        : [Number((value as JsonNumber).lexeme)];
    const values =
      (value as JsonValue[] | null)
        ?.filter((v) => v !== null)
        .map((v) => Number((v as JsonNumber).lexeme)) ?? [];
    if (target.projection === "sum") return [values.reduce((a, b) => a + b, 0)];
    if (target.projection === "nodeCount") return [values.length];
    return values;
  };
  for (const c of constraints) {
    switch (c.kind) {
      case "range":
        if (
          project(c.target).some(
            (n) =>
              !Number.isFinite(n) ||
              (c.min !== undefined && n < c.min) ||
              (c.max !== undefined && n > c.max),
          )
        )
          throw new Error(
            `argument ${c.target.parameter}: ${c.target.projection} outside allowed range`,
          );
        break;
      case "comparison": {
        const [a, b] = [project(c.left)[0], project(c.right)[0]];
        const valid = { eq: a === b, le: a <= b, lt: a < b, ge: a >= b, gt: a > b }[c.operator];
        if (!valid || !Number.isFinite(a) || !Number.isFinite(b))
          throw new Error(
            `arguments ${c.left.parameter} and ${c.right.parameter}: comparison ${c.operator} failed`,
          );
        break;
      }
      case "property": {
        const values = project(c.target);
        const seen = new Set<number>();
        for (let i = 0; i < values.length; i++) {
          if (
            (c.property === "unique" && seen.has(values[i])) ||
            (c.property !== "unique" && i > 0 && values[i - 1] > values[i])
          )
            throw new Error(`argument ${c.target.parameter}: requires ${c.property}`);
          seen.add(values[i]);
        }
        break;
      }
    }
  }
}
/** Validate a raw classic coding case and its constraints. */
export function validateCodingCase(
  sig: Signature,
  constraints: readonly Constraint[],
  json: string,
  required = true,
  limit = 10000,
): void {
  const data = object(parseLosslessJson(json));
  if (Array.isArray(data.calls) && data.calls.length)
    throw new Error("method sequences require Odyssey");
  applyConstraints(sig, constraints, rawCase(sig, data, required, limit));
}
/** Validate an Odyssey sequence against currently unlocked methods. */
export function validateCodingSequence(
  primary: Signature,
  constraints: readonly Constraint[],
  methods: readonly Signature[],
  json: string,
  required = true,
  limit = 10000,
): void {
  const data = object(parseLosslessJson(json));
  if (
    !Array.isArray(data.calls) ||
    data.calls.length < 1 ||
    data.calls.length > 100 ||
    !Array.isArray(data.args) ||
    data.args.length ||
    Object.hasOwn(data, "expected")
  )
    throw new Error("sequence requires 1 to 100 calls and empty top-level args");
  const byName = new Map(methods.map((sig) => [sig.methodName, sig]));
  for (const entry of data.calls) {
    const call = object(entry);
    const sig = byName.get(typeof call.methodName === "string" ? call.methodName : "");
    if (!sig)
      throw new Error(
        `unknown method ${typeof call.methodName === "string" ? call.methodName : ""}`,
      );
    const effective = sig.returnType === "void" ? { ...sig, returnType: "optional<int>" } : sig;
    const args = rawCase(
      effective,
      sig.returnType === "void" ? { ...call, expected: null } : call,
      required,
      limit,
    );
    if (sig.methodName === primary.methodName) applyConstraints(primary, constraints, args);
  }
}
function normalizeOutput(sig: Signature, value: JsonValue): JsonValue {
  const result = normalizeQuestionValue(sig.returnType, value);
  if (sig.outputOrder !== "unordered") return result;
  if (!Array.isArray(result)) throw new Error("expected list");
  return [...result].sort((a, b) =>
    compareUtf8(stringifyLosslessJson(a), stringifyLosslessJson(b)),
  );
}

/** Compare a coding result with a raw classic or Odyssey case. */
export function compareCodingCase(
  sig: Signature,
  methods: readonly Signature[],
  caseJson: string,
  status: string,
  outputJson: string,
): { status: string; actual?: string; expected?: string } {
  if (status !== "executed") return { status };
  const data = object(parseLosslessJson(caseJson));
  const calls = Array.isArray(data.calls) ? data.calls : [];
  const byName = new Map(methods.map((method) => [method.methodName, method]));
  const normalize = (value: JsonValue): JsonValue => {
    if (!calls.length) return normalizeOutput(sig, value);
    if (!Array.isArray(value) || value.length !== calls.length)
      throw new Error("invalid sequence result");
    return value.map((item, i) => {
      const call = object(calls[i]);
      const method = byName.get(typeof call.methodName === "string" ? call.methodName : "");
      if (!method) throw new Error("unknown method");
      return method.returnType === "void" ? null : normalizeOutput(method, item);
    });
  };
  let actual: string;
  try {
    actual = stringifyLosslessJson(normalize(parseLosslessJson(outputJson)));
  } catch {
    return { status: "invalid_output" };
  }
  let expected: JsonValue | undefined = data.expected;
  if (calls.length) {
    const values: JsonValue[] = [];
    for (const item of calls) {
      const call = object(item),
        method = byName.get(typeof call.methodName === "string" ? call.methodName : "");
      if (!method) throw new Error("unknown method");
      if (method.returnType === "void") values.push(null);
      else if (Object.hasOwn(call, "expected")) values.push(call.expected);
      else return { status: "executed", actual };
    }
    expected = values;
  }
  if (expected === undefined) return { status: "executed", actual };
  let normalized: string;
  try {
    normalized = stringifyLosslessJson(normalize(expected));
  } catch (error) {
    throw new Error(
      `invalid trusted expectation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    status: actual === normalized ? "accepted" : "wrong_answer",
    actual,
    expected: normalized,
  };
}
