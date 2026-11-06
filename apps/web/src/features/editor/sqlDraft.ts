import { z } from "zod";
import type { InputConstraint } from "../../ui/input-constraints";
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
  if (type === "date" && !z.iso.date().safeParse(source).success)
    throw new Error("Use a valid YYYY-MM-DD date.");
  if (
    (type === "timestamp" || type === "timestamptz") &&
    !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(source)
  )
    throw new Error("Use YYYY-MM-DD HH:MM:SS.");
  return source;
}

/** SQL cells preserve text verbatim; machine values admit editable prefixes. */
export function sqlCellInputConstraint(type: string): InputConstraint | undefined {
  if (type === "text") return undefined;
  let accepts: (value: string) => boolean;
  if (type === "integer" || type === "bigint") {
    const min = type === "integer" ? -2147483648n : -9223372036854775808n;
    const max = type === "integer" ? 2147483647n : 9223372036854775807n;
    accepts = (value) =>
      /^-?\d*$/.test(value) &&
      (!/^-?\d+$/.test(value) || (BigInt(value) >= min && BigInt(value) <= max));
  } else if (["numeric", "real", "double precision"].includes(type)) {
    accepts = (value) =>
      value.length <= 128 &&
      /^-?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{0,3})?|\.)?$/.test(value) &&
      (!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ||
        type === "numeric" ||
        (Number.isFinite(Number(value)) &&
          (type !== "real" || Number.isFinite(Math.fround(Number(value))))));
  } else if (["date", "timestamp", "timestamptz"].includes(type)) {
    accepts = (value) => {
      const pattern =
        type === "date"
          ? /^\d{0,4}(?:-\d{0,2}(?:-\d{0,2})?)?$/
          : /^\d{0,4}(?:-\d{0,2}(?:-\d{0,2}(?:[ T]\d{0,2}(?::\d{0,2}(?::\d{0,2}(?:\.\d*)?)?)?(?:Z|[+-]\d{0,2}(?::?\d{0,2})?)?)?)?)?$/;
      if (!pattern.test(value)) return false;
      if (value.length >= 10 && !z.iso.date().safeParse(value.slice(0, 10)).success) return false;
      const parts = value.match(
        /^\d{4}-(\d{2})(?:-(\d{2}))?(?:[ T](\d{2})(?::(\d{2}))?(?::(\d{2}))?)?/,
      );
      return (
        !parts ||
        (Number(parts[1]) >= 1 &&
          Number(parts[1]) <= 12 &&
          (!parts[2] || (Number(parts[2]) >= 1 && Number(parts[2]) <= 31)) &&
          (!parts[3] || Number(parts[3]) <= 23) &&
          (!parts[4] || Number(parts[4]) <= 59) &&
          (!parts[5] || Number(parts[5]) <= 59))
      );
    };
  } else return undefined;
  return {
    edit: accepts,
    schema: z.string().refine((value) => {
      try {
        cell(value, type, false);
        return true;
      } catch {
        return false;
      }
    }, "Enter a valid SQL cell value."),
    trim: true,
  };
}

function rows(values: unknown[][], columns: Column[], output: boolean, name: string) {
  return values.map((row, rowIndex) => {
    if (row.length !== columns.length)
      throw new Error(`${name}, row ${rowIndex + 1}: wrong number of cells.`);
    return row.map((value, index) => {
      try {
        const type = columns[index]!.type;
        const parsed = z
          .unknown()
          .transform((source, context) => {
            try {
              return cell(source, type, output);
            } catch (cause) {
              context.addIssue({
                code: "custom",
                message: cause instanceof Error ? cause.message : "Invalid SQL cell.",
              });
              return z.NEVER;
            }
          })
          .safeParse(value);
        if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);
        return parsed.data;
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
    const source = matches[0]!;
    const normalizedRows = rows(source.rows, table.columns, false, table.name);
    return problem.sql?.tables?.length
      ? { name: table.name, rows: normalizedRows }
      : { ...source, rows: normalizedRows };
  });
  if (!expected) return { args: [{ tables }] };
  const result = parseSqlResult(expected);
  const columns = sqlOutputColumns(problem, setup, result);
  if (!columns.length) throw new Error("Output schema is unavailable.");
  return {
    args: [{ tables }],
    expected: {
      ...(problem.sql?.output?.length ? {} : result),
      rows: rows(result.rows, columns, true, "Output"),
    },
  };
}

export function sqlDefault(type: string): unknown {
  if (type === "boolean") return false;
  if (["integer", "bigint", "numeric", "real", "double precision"].includes(type)) return "0";
  return "";
}
export type { Column as SqlDraftColumn };
