/** @file projection.ts @description Lossless safe result field projection. @module judging */
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
type Obj = { [key: string]: JsonValue };
export function object(v: JsonValue | undefined): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v) || v instanceof JsonNumber)
    throw new Error("Invalid result object");
  return v;
}
function string(v: JsonValue | undefined): string {
  if (typeof v !== "string") throw new Error("Invalid result string");
  return v;
}
function integer(v: JsonValue | undefined): JsonNumber {
  if (
    !(v instanceof JsonNumber) ||
    !/^(0|[1-9][0-9]*)$/.test(v.lexeme) ||
    BigInt(v.lexeme) > 2147483647n
  )
    throw new Error("Invalid result integer");
  return v;
}
export function diagnosticList(v: JsonValue): JsonValue {
  if (!Array.isArray(v)) throw new Error("Invalid diagnostics");
  return v.map((item) => {
    const d = object(item),
      out: Obj = { message: string(d.message) };
    if (d.line !== undefined) out.line = integer(d.line);
    if (d.column !== undefined) out.column = integer(d.column);
    return out;
  });
}
export function resultCase(v: JsonValue, hidden: boolean): Obj {
  const item = object(v),
    out: Obj = { index: integer(item.index), status: string(item.status) };
  if (hidden) return out;
  for (const name of ["stdout", "stderr"])
    if (item[name] !== undefined) out[name] = string(item[name]);
  for (const name of ["actual", "expected"]) if (item[name] !== undefined) out[name] = item[name];
  if (item.sqlTypes !== undefined) {
    if (!Array.isArray(item.sqlTypes)) throw new Error("Invalid SQL types");
    out.sqlTypes = item.sqlTypes.map(string);
  }
  if (item.diagnostics !== undefined) out.diagnostics = diagnosticList(item.diagnostics);
  return out;
}
function cases(v: JsonValue, hidden: boolean): JsonValue {
  if (!Array.isArray(v)) throw new Error("Invalid case results");
  return v.map((c) => resultCase(c, hidden));
}
export function publicResult(raw: Uint8Array | null, interviewSubmit: boolean): Obj {
  if (!raw) return {};
  const value = object(parseLosslessJson(new TextDecoder("utf-8", { fatal: true }).decode(raw))),
    out: Obj = {};
  for (const name of ["verdict", "infrastructureError"])
    if (value[name] !== undefined) out[name] = string(value[name]);
  if (value.score !== undefined && value.score !== null) {
    const score = object(value.score);
    out.score = { passed: integer(score.passed), total: integer(score.total) };
  }
  if (value.publicCases !== undefined && value.publicCases !== null)
    out.publicCases = cases(value.publicCases, false);
  if (!interviewSubmit && value.hiddenCases !== undefined && value.hiddenCases !== null)
    out.hiddenCases = cases(value.hiddenCases, true);
  if (!interviewSubmit && value.diagnostics !== undefined && value.diagnostics !== null)
    out.diagnostics = diagnosticList(value.diagnostics);
  return out;
}
export function encode(value: Obj): string {
  return stringifyLosslessJson(value);
}
