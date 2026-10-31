/** @file sql-result.ts @description Lossless PostgreSQL result normalization and comparison. @module questions */
import type { components } from "@quorem/contracts/schema";
import {
  compareUtf8,
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "./json.ts";
import { normalizeQuestionValue } from "./value-codec.ts";

type SqlConfig = components["schemas"]["SqlConfig"];
const numeric = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]{1,3})?$/;
function decimal(text: string): string {
  if (text.length > 128 || !numeric.test(text)) throw new Error("invalid SQL numeric value");
  const [mantissa, exponentText] = text.toLowerCase().split("e");
  const negative = mantissa.startsWith("-");
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = (whole + fraction).replace(/^0+/, "") || "0";
  if (digits === "0") return "0";
  const scale = fraction.length - Number(exponentText ?? 0);
  let result: string;
  if (scale <= 0) result = digits + "0".repeat(-scale);
  else if (scale >= digits.length) result = "0." + "0".repeat(scale - digits.length) + digits;
  else result = digits.slice(0, -scale) + "." + digits.slice(-scale);
  if (result.includes(".")) result = result.replace(/0+$/, "").replace(/\.$/, "");
  return (negative ? "-" : "") + result;
}
function canonical(value: JsonValue): JsonValue {
  if (value instanceof JsonNumber) {
    if (/^-?\d+$/.test(value.lexeme)) {
      const n = BigInt(value.lexeme);
      if (n < -2147483648n || n > 2147483647n)
        throw new Error("large SQL integers require a bigint marker");
    }
    return value;
  }
  if (typeof value === "string") {
    if (value.includes("\0")) throw new Error("SQL text cannot contain NUL characters");
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (Array.isArray(value)) throw new Error("unsupported SQL result value");
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$numeric" && typeof value.$numeric === "string")
    return { $numeric: decimal(value.$numeric) };
  if (
    keys.length === 1 &&
    keys[0] === "$bigint" &&
    typeof value.$bigint === "string" &&
    value.$bigint.length <= 20 &&
    /^[+-]?\d+$/.test(value.$bigint)
  ) {
    const n = BigInt(value.$bigint);
    if (n < -9223372036854775808n || n > 9223372036854775807n)
      throw new Error("invalid SQL bigint value");
    return n >= -2147483648n && n <= 2147483647n
      ? new JsonNumber(n.toString())
      : { $bigint: n.toString() };
  }
  throw new Error(
    keys.includes("$bigint")
      ? "invalid SQL bigint value"
      : keys.includes("$numeric")
        ? "invalid SQL numeric value"
        : "unsupported SQL result value",
  );
}
function timestamp(kind: string, text: string): string {
  const m = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)?$/.exec(text);
  if (!m) throw new Error("invalid SQL timestamp");
  try {
    normalizeQuestionValue("datetime", `${m[1]}T${m[2]}`);
  } catch {
    throw new Error("invalid SQL timestamp");
  }
  const fraction = m[3] ?? "";
  let micros = Number(fraction.slice(0, 6).padEnd(6, "0"));
  if (
    fraction.length > 6 &&
    (fraction[6] > "5" ||
      (fraction[6] === "5" && (/[1-9]/.test(fraction.slice(7)) || micros % 2 === 1)))
  )
    micros++;
  const zone = kind === "timestamptz" ? (m[4] ?? "Z") : "Z";
  const base = Date.parse(`${m[1]}T${m[2]}${zone}`);
  if (!Number.isFinite(base)) throw new Error("invalid SQL timestamp");
  const date = new Date(base + Math.floor(micros / 1000000) * 1000);
  const iso = date.toISOString().slice(0, 19);
  const part = String(micros % 1000000)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return iso + (part ? `.${part}` : "") + (kind === "timestamptz" ? "Z" : "");
}
function scientific(value: number): string {
  if (Object.is(value, -0)) return "-0e+00";
  const [coefficient, power] = value.toExponential().split("e");
  const n = Number(power);
  return `${coefficient}e${n < 0 ? "-" : "+"}${String(Math.abs(n)).padStart(2, "0")}`;
}

/** Normalize SQL output JSON; numeric markers and number lexemes remain exact. */
export function normalizeSqlResult(config: SqlConfig, json: string): string {
  const value = parseLosslessJson(json);
  if (!value || value instanceof JsonNumber || Array.isArray(value) || typeof value !== "object")
    throw new Error("invalid SQL result");
  const columns = value.columns ?? config.output?.map((col) => col.name);
  if (
    !Array.isArray(columns) ||
    columns.length < 1 ||
    columns.length > 32 ||
    columns.some(
      (col) =>
        typeof col !== "string" ||
        !col ||
        new TextEncoder().encode(col).length > 256 ||
        col.includes("\0"),
    ) ||
    !Array.isArray(value.rows) ||
    value.rows.length > 10000
  )
    throw new Error("invalid SQL result");
  const rows = value.rows.map((row) => {
    if (!Array.isArray(row) || row.length !== columns.length)
      throw new Error("SQL result row width mismatch");
    return row.map((cell, i) => {
      const kind = config.output?.[i]?.type;
      if ((kind === "timestamp" || kind === "timestamptz") && typeof cell === "string")
        return timestamp(kind, cell);
      if ((kind === "real" || kind === "double precision") && cell instanceof JsonNumber) {
        const number = Number(cell.lexeme);
        const f = kind === "real" ? Math.fround(number) : number;
        if (Number.isFinite(f)) return new JsonNumber(scientific(f));
      }
      return canonical(cell);
    });
  });
  if (config.outputOrder === "unordered")
    rows.sort((a, b) => compareUtf8(stringifyLosslessJson(a), stringifyLosslessJson(b)));
  return `{"columns":${stringifyLosslessJson(columns)},"rows":${stringifyLosslessJson(rows)}}`;
}
/** Compare SQL result values and declared output types. */
export function compareSqlResult(
  config: SqlConfig,
  status: string,
  actualJson: string,
  expectedJson: string | undefined,
  sqlTypes: readonly string[],
): { status: string; actual?: string; expected?: string; typeMismatch: boolean } {
  if (status !== "executed") return { status, typeMismatch: false };
  let actual: string;
  try {
    actual = normalizeSqlResult(config, actualJson);
  } catch {
    return { status: "invalid_output", typeMismatch: false };
  }
  const mismatch =
    !!config.output?.length &&
    (config.output.length !== sqlTypes.length ||
      config.output.some((c, i) => c.type !== sqlTypes[i]));
  if (expectedJson === undefined)
    return { status: mismatch ? "wrong_answer" : "executed", actual, typeMismatch: mismatch };
  let expected: string;
  try {
    expected = normalizeSqlResult(config, expectedJson);
  } catch (error) {
    throw new Error(
      `invalid trusted expectation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    status: actual === expected && !mismatch ? "accepted" : "wrong_answer",
    actual,
    expected,
    typeMismatch: mismatch,
  };
}
