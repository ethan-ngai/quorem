/** @file sql-case.ts @description PostgreSQL schema-bound case validation. @module questions */
import type { components } from "@quorem/contracts/schema";
import { JsonNumber, parseLosslessJson, type JsonValue } from "./json.ts";
import { normalizeSqlTimestamp } from "./sql-result.ts";

type SqlConfig = components["schemas"]["SqlConfig"];
type SqlColumn = components["schemas"]["SqlColumn"];
const numeric = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]{1,3})?$/;
const identifier = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function object(value: JsonValue | undefined): { [key: string]: JsonValue } | undefined {
  return value !== null &&
    typeof value === "object" &&
    !(value instanceof JsonNumber) &&
    !Array.isArray(value)
    ? value
    : undefined;
}
function containsNul(value: JsonValue): boolean {
  if (typeof value === "string") return value.includes("\0");
  if (Array.isArray(value)) return value.some(containsNul);
  const obj = object(value);
  return obj ? Object.entries(obj).some(([k, v]) => k.includes("\0") || containsNul(v)) : false;
}
function valueValid(kind: string, value: JsonValue, result: boolean): boolean {
  if (value === null) return true;
  const marker = object(value);
  if (marker) {
    if (!result) return false;
    const keys = Object.keys(marker);
    if (keys.length !== 1) return false;
    if (kind === "numeric" && typeof marker.$numeric === "string")
      return valueValid("numeric", marker.$numeric, false);
    if (kind === "bigint" && typeof marker.$bigint === "string")
      return valueValid("bigint", marker.$bigint, false);
    return false;
  }
  if (kind === "real" || kind === "double precision") {
    if (!result || !(value instanceof JsonNumber)) return false;
    const n = Number(value.lexeme);
    return Number.isFinite(n) && (kind !== "real" || Number.isFinite(Math.fround(n)));
  }
  if (kind === "integer" || kind === "bigint") {
    if (
      !(value instanceof JsonNumber) &&
      !(kind === "bigint" && typeof value === "string" && !result)
    )
      return false;
    const s = value instanceof JsonNumber ? value.lexeme : (value as string);
    if (!/^[+-]?\d+$/.test(s)) return false;
    try {
      const n = BigInt(s);
      const min =
        kind === "integer" || value instanceof JsonNumber ? -2147483648n : -9223372036854775808n;
      const max =
        kind === "integer" || value instanceof JsonNumber ? 2147483647n : 9223372036854775807n;
      return n >= min && n <= max;
    } catch {
      return false;
    }
  }
  if (kind === "numeric") {
    if (result) return false;
    const s = value instanceof JsonNumber ? value.lexeme : value;
    return typeof s === "string" && s.length <= 128 && numeric.test(s);
  }
  if (kind === "text") return typeof value === "string" && !value.includes("\0");
  if (kind === "boolean") return typeof value === "boolean";
  if (kind === "date" || kind === "timestamp" || kind === "timestamptz") {
    if (typeof value !== "string") return false;
    try {
      normalizeSqlTimestamp(kind, kind === "date" ? `${value}T00:00:00` : value);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
/** Validate publication SQL table and output schema. */
export function validateSqlSchema(config: SqlConfig): void {
  if (config.dialect !== "postgresql" || !["ordered", "unordered"].includes(config.outputOrder))
    throw new Error("invalid SQL dialect or output order");
  if (
    !config.tables?.length ||
    config.tables.length > 16 ||
    !config.output?.length ||
    config.output.length > 32
  )
    throw new Error("SQL input and output schema required");
  const names = new Set<string>();
  const columns = (cols: SqlColumn[], output: boolean) => {
    const seen = new Set<string>();
    for (const col of cols) {
      if (
        output
          ? !col.name || new TextEncoder().encode(col.name).length > 256
          : !identifier.test(col.name) || col.name.length > 63 || seen.has(col.name)
      )
        throw new Error("invalid SQL column schema");
      if (
        ![
          "integer",
          "bigint",
          "numeric",
          "text",
          "boolean",
          "date",
          "timestamp",
          "timestamptz",
          ...(output ? ["real", "double precision"] : []),
        ].includes(col.type)
      )
        throw new Error("unsupported SQL column type");
      seen.add(col.name);
    }
  };
  for (const table of config.tables) {
    if (
      !identifier.test(table.name) ||
      table.name.length > 63 ||
      names.has(table.name) ||
      table.columns.length < 1 ||
      table.columns.length > 32
    )
      throw new Error("invalid SQL table schema");
    names.add(table.name);
    columns(table.columns, false);
  }
  columns(config.output, true);
}
/** Validate a SQL case against its declared table and result schema. */
export function validateSqlCase(config: SqlConfig, json: string, required = true): void {
  const value = parseLosslessJson(json);
  const c = object(value);
  if (!c) throw new Error("SQL case requires one table setup");
  if (containsNul({ args: c.args ?? null, expected: c.expected ?? null, calls: c.calls ?? null }))
    throw new Error("SQL text cannot contain NUL characters");
  if ((Array.isArray(c.calls) && c.calls.length) || !Array.isArray(c.args) || c.args.length !== 1)
    throw new Error("SQL case requires one table setup");
  const setup = object(c.args[0]);
  if (!setup || !Array.isArray(setup.tables) || setup.tables.length < 1 || setup.tables.length > 16)
    throw new Error("SQL setup requires 1 to 16 tables");
  if (!config.tables?.length || setup.tables.length !== config.tables.length)
    throw new Error("SQL case tables must match the schema");
  const seen = new Set<string>();
  for (const item of setup.tables) {
    const t = object(item);
    const schema = config.tables.find((s) => s.name === t?.name);
    if (
      !t ||
      !schema ||
      typeof t.name !== "string" ||
      seen.has(t.name) ||
      (Object.hasOwn(t, "columns") && t.columns !== null) ||
      !Array.isArray(t.rows) ||
      t.rows.length > 200
    )
      throw new Error("SQL case tables must match the schema and contain rows only");
    seen.add(t.name);
    for (const row of t.rows) {
      if (!Array.isArray(row) || row.length !== schema.columns.length)
        throw new Error("SQL row width mismatch");
      if (row.some((cell, i) => !valueValid(schema.columns[i].type, cell, false)))
        throw new Error("invalid SQL table value");
    }
  }
  if (!Object.hasOwn(c, "expected") && !required) return;
  const result = object(c.expected);
  if (
    !result ||
    (Object.hasOwn(result, "columns") && result.columns !== null) ||
    !Array.isArray(result.rows) ||
    result.rows.length > 10000
  )
    throw new Error("SQL expected result must contain rows only");
  for (const row of result.rows) {
    if (!Array.isArray(row) || row.length !== (config.output?.length ?? 0))
      throw new Error("SQL result row width mismatch");
    if (row.some((cell, i) => !valueValid(config.output![i].type, cell, true)))
      throw new Error("invalid SQL result value");
  }
}
