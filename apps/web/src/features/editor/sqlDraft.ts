import type { QuestionProblem } from "@quorem/contracts";

type Column = { name: string; type: string };
type Table = { name: string; columns?: Column[]; rows: unknown[][] };
type Setup = { tables: Table[] };
type Result = { columns?: string[]; rows: unknown[][] };

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function sqlTables(problem: QuestionProblem, setup: Setup) {
  return (problem.sql?.tables?.length ? problem.sql.tables : setup.tables).map((table) => ({
    name: table.name,
    columns: table.columns ?? [],
  }));
}

export function sqlOutputColumns(problem: QuestionProblem, setup: Setup, result: Result): Column[] {
  if (problem.sql?.output?.length) return problem.sql.output;
  const columns = sqlTables(problem, setup).flatMap((table) => table.columns);
  return (result.columns ?? []).map((name, index) => ({
    name,
    type:
      columns.find((column) => column.name === name)?.type ??
      (typeof result.rows[0]?.[index] === "number" ? "integer" : "text"),
  }));
}

export function parseSqlSetup(source: string): Setup {
  const value: unknown = JSON.parse(source);
  if (
    !object(value) ||
    !Array.isArray(value.tables) ||
    value.tables.some(
      (table: unknown) =>
        !object(table) ||
        typeof table.name !== "string" ||
        !Array.isArray(table.rows) ||
        !table.rows.every(Array.isArray),
    )
  )
    throw new Error("Invalid table data.");
  return value as Setup;
}
export function parseSqlResult(source: string): Result {
  const value: unknown = JSON.parse(source);
  if (!object(value) || !Array.isArray(value.rows) || !value.rows.every(Array.isArray))
    throw new Error("Invalid output table.");
  return value as Result;
}

export function sqlCellText(value: unknown): string {
  if (object(value)) {
    const text = value.$numeric ?? value.$bigint;
    return typeof text === "string" ? text : "";
  }
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

function cell(value: unknown, type: string, output: boolean): unknown {
  if (value === null) return null;
  const source = sqlCellText(value);
  if (type === "text") {
    if (source.includes("\0")) throw new Error("SQL text cannot contain NUL characters.");
    return source;
  }
  if (type === "boolean") {
    if (source === "true") return true;
    if (source === "false") return false;
    throw new Error("Enter true or false.");
  }
  if (type === "integer" || type === "bigint") {
    if (!/^-?\d+$/.test(source)) throw new Error("Enter an integer.");
    const number = BigInt(source);
    const min = type === "integer" ? -2147483648n : -9223372036854775808n;
    const max = type === "integer" ? 2147483647n : 9223372036854775807n;
    if (number < min || number > max) throw new Error("Integer is out of range.");
    if (type === "integer") return Number(number);
    return output ? { $bigint: number.toString() } : number.toString();
  }
  if (type === "numeric") {
    if (source.length > 128 || !/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?$/.test(source))
      throw new Error("Enter a valid number.");
    return output ? { $numeric: source } : source;
  }
  if (type === "real" || type === "double precision") {
    const number = Number(source);
    if (
      !source.trim() ||
      !Number.isFinite(number) ||
      (type === "real" && !Number.isFinite(Math.fround(number)))
    )
      throw new Error("Enter a valid number in range.");
    return number;
  }
  if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(source)) throw new Error("Use YYYY-MM-DD.");
  if (
    (type === "timestamp" || type === "timestamptz") &&
    !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(source)
  )
    throw new Error("Use YYYY-MM-DD HH:MM:SS.");
  return source;
}

function rows(values: unknown[][], columns: Column[], output: boolean, name: string) {
  return values.map((row, rowIndex) => {
    if (row.length !== columns.length)
      throw new Error(`${name}, row ${rowIndex + 1}: wrong number of cells.`);
    return row.map((value, index) => {
      try {
        return cell(value, columns[index]!.type, output);
      } catch (error) {
        throw new Error(
          `${name}, row ${rowIndex + 1}, ${columns[index]!.name}: ${(error as Error).message}`,
        );
      }
    });
  });
}

export function normalizeSqlDraft(problem: QuestionProblem, source: string, expected?: string) {
  const setup = parseSqlSetup(source);
  const schema = sqlTables(problem, setup);
  if (!schema.length || setup.tables.length !== schema.length)
    throw new Error("Tables must match the schema.");
  const tables = schema.map((table) => {
    const matches = setup.tables.filter((item) => item.name === table.name);
    if (matches.length !== 1) throw new Error(`Missing or duplicate table ${table.name}.`);
    return { ...matches[0]!, rows: rows(matches[0]!.rows, table.columns, false, table.name) };
  });
  if (!expected) return { args: [{ tables }] };
  const result = parseSqlResult(expected);
  const columns = sqlOutputColumns(problem, setup, result);
  if (!columns.length) throw new Error("Output schema is unavailable.");
  return {
    args: [{ tables }],
    expected: { ...result, rows: rows(result.rows, columns, true, "Output") },
  };
}

export function sqlDefault(type: string): unknown {
  if (type === "boolean") return false;
  if (["integer", "bigint", "numeric", "real", "double precision"].includes(type)) return "0";
  return "";
}
export type { Column as SqlDraftColumn };
