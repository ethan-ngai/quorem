/** @file legacy-header.ts @description Bounded legacy header field normalization. @module judging */
import { JsonNumber } from "@quorem/questions";
import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { StreamingJsonReader } from "@quorem/questions";
import {
  legacyRaw as slice,
  legacyKind as type,
  legacyInteger as integer,
  legacySource,
} from "./legacy-sql.ts";
import { legacyFields, legacySpan, type Fields } from "./legacy-case.ts";
const source = (id: string) => legacySource(id, "public");
async function insertField(
  tx: Transaction,
  id: string,
  field: string,
  data: SQL,
  valid: SQL,
): Promise<void> {
  const result = await tx.execute<{ ok: boolean }>(
    sql`WITH source AS (${source(id)}), projected AS (SELECT ${data} AS data,${valid} AS valid FROM source), inserted AS (INSERT INTO submission_result_header_fields(submission_id,field,field_data) SELECT ${id}::uuid,${field},data FROM projected WHERE valid ON CONFLICT DO NOTHING RETURNING 1) SELECT EXISTS(SELECT 1 FROM inserted) OR EXISTS(SELECT 1 FROM submission_result_header_fields,projected WHERE submission_id=${id}::uuid AND field=${field} AND projected.valid AND field_data=projected.data) AS ok`,
  );
  if (!result.rows[0]?.ok) throw new Error("Invalid or conflicting legacy header field");
}
/** Stream a scalar raw JSON string into its immutable field row. */
export async function legacyHeaderString(
  tx: Transaction,
  id: string,
  field: "verdict" | "infrastructureError",
  input: StreamingJsonReader,
): Promise<void> {
  const value = await legacySpan(input);
  await insertField(tx, id, field, slice(value), sql`${type(slice(value))}='string'`);
}
async function spool(
  tx: Transaction,
  ordinal: number,
  values: Fields,
  keys: readonly string[],
): Promise<void> {
  const a = values.get(keys[0]),
    b = values.get(keys[1]),
    c = values.get(keys[2] ?? "");
  if (!a || (!b && keys[1] === "status")) throw new Error("Invalid legacy header item");
  await tx.execute(
    sql`INSERT INTO quorem_legacy_header_spans VALUES(${ordinal},${a.start},${a.length},${b?.start ?? null},${b?.length ?? null},${c?.start ?? null},${c?.length ?? null})`,
  );
}
/** Spools offsets, then builds one sanitized array in PostgreSQL without Worker aggregation. */
export async function legacyHeaderArray(
  tx: Transaction,
  id: string,
  field: "diagnostics" | "hiddenCases",
  input: StreamingJsonReader,
): Promise<number> {
  await tx.execute(
    sql`CREATE TEMP TABLE IF NOT EXISTS quorem_legacy_header_spans(ordinal integer,a integer,al integer,b integer,bl integer,c integer,cl integer) ON COMMIT DROP`,
  );
  await tx.execute(sql`TRUNCATE quorem_legacy_header_spans`);
  await input.peek();
  const start = input.byteOffset;
  await input.expect("[");
  let count = 0;
  const keys = field === "diagnostics" ? ["message", "line", "column"] : ["index", "status"];
  while ((await input.peek()) !== "]") {
    await spool(tx, count++, await legacyFields(input, new Set(keys)), keys);
    if ((await input.peek()) === ",") await input.expect(",");
    else break;
  }
  await input.expect("]");
  const whole = { start, length: input.byteOffset - start };
  const a = sql`substring(source.raw FROM x.a+1 FOR x.al)`,
    b = sql`substring(source.raw FROM x.b+1 FOR x.bl)`,
    c = sql`substring(source.raw FROM x.c+1 FOR x.cl)`;
  const validItems =
    field === "diagnostics"
      ? sql`${type(a)}='string' AND (x.b IS NULL OR ${integer(b)}) AND (x.c IS NULL OR ${integer(c)})`
      : sql`${integer(a)} AND ${type(b)}='string'`;
  const item =
    field === "diagnostics"
      ? sql`convert_to('{','UTF8') || CASE WHEN x.c IS NULL THEN ''::bytea ELSE convert_to('"column":','UTF8') || ${c} || convert_to(',','UTF8') END || CASE WHEN x.b IS NULL THEN ''::bytea ELSE convert_to('"line":','UTF8') || ${b} || convert_to(',','UTF8') END || convert_to('"message":','UTF8') || ${a} || convert_to('}','UTF8')`
      : sql`convert_to('{"index":','UTF8') || ${a} || convert_to(',"status":','UTF8') || ${b} || convert_to('}','UTF8')`;
  const data = sql`convert_to('[','UTF8') || COALESCE((SELECT string_agg(${item},convert_to(',','UTF8') ORDER BY x.ordinal) FROM quorem_legacy_header_spans x),''::bytea) || convert_to(']','UTF8')`;
  const valid = sql`${type(slice(whole))}='array' AND NOT EXISTS(SELECT 1 FROM quorem_legacy_header_spans x WHERE NOT (${validItems}))`;
  await insertField(tx, id, field, data, valid);
  return count;
}
/** Validate the full object without decoding any string fields. */
export async function validateLegacyHeader(tx: Transaction, id: string): Promise<void> {
  const row = (
    await tx.execute<{ ok: boolean }>(
      sql`SELECT json_typeof(convert_from(raw,'UTF8')::json)='object' AS ok FROM (${source(id)}) source`,
    )
  ).rows[0];
  if (!row?.ok) throw new Error("Invalid legacy result");
}
/** Extract bounded score integers after validating the raw object in PostgreSQL. */
export async function legacyScore(
  tx: Transaction,
  id: string,
  input: StreamingJsonReader,
): Promise<{ passed: JsonNumber; total: JsonNumber }> {
  await input.peek();
  const start = input.byteOffset;
  const fields = await legacyFields(input, new Set(["passed", "total"]));
  const whole = { start, length: input.byteOffset - start },
    passed = fields.get("passed"),
    total = fields.get("total");
  if (!passed || !total) throw new Error("Invalid legacy score");
  const valid = sql`${type(slice(whole))}='object' AND ${integer(slice(passed))} AND ${integer(slice(total))}`;
  const row = (
    await tx.execute<{ passed: string; total: string }>(
      sql`SELECT CASE WHEN ${valid} THEN convert_from(${slice(passed)},'UTF8') END AS passed,CASE WHEN ${valid} THEN convert_from(${slice(total)},'UTF8') END AS total FROM (${source(id)}) source`,
    )
  ).rows[0];
  if (!row?.passed || !row.total) throw new Error("Invalid legacy score");
  return { passed: new JsonNumber(row.passed), total: new JsonNumber(row.total) };
}
