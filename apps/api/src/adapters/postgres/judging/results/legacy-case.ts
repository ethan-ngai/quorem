/** @file legacy-case.ts @description Bounded, lossless normalization of legacy case objects. @module judging */
import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { legacyRaw, legacyKind, legacyInteger, legacySource } from "./legacy-sql.ts";
import { StreamingJsonReader } from "@quorem/questions";
export class LegacyCaseConflict extends Error {}
export type Span = { start: number; length: number };
export type Fields = Map<string, Span>;
const names = new Set([
  "index",
  "status",
  "stdout",
  "stderr",
  "actual",
  "expected",
  "sqlTypes",
  "diagnostics",
]);
export async function legacyKey(input: StreamingJsonReader): Promise<string> {
  let text = "",
    large = false;
  for await (const part of input.valueChunks()) {
    if (!large && text.length + part.length <= 128) text += part;
    else large = true;
  }
  return large ? "" : (JSON.parse(text) as string);
}
export async function legacySpan(input: StreamingJsonReader): Promise<Span> {
  await input.peek();
  const start = input.byteOffset;
  for await (const _ of input.valueChunks()) {
    /* keep only offsets */
  }
  return { start, length: input.byteOffset - start };
}
export async function legacyFields(
  input: StreamingJsonReader,
  accepted: Set<string>,
  diagnostics?: (item: Fields, ordinal: number) => Promise<void>,
): Promise<Fields> {
  const out: Fields = new Map();
  await input.expect("{");
  while ((await input.peek()) !== "}") {
    const name = await legacyKey(input);
    await input.expect(":");
    if (accepted.has(name)) {
      if (out.has(name)) throw new Error("Duplicate legacy case field");
      if (name === "diagnostics" && diagnostics && (await input.peek()) === "[") {
        await input.peek();
        const start = input.byteOffset;
        await input.expect("[");
        let ordinal = 0;
        while ((await input.peek()) !== "]") {
          await diagnostics(
            await legacyFields(input, new Set(["message", "line", "column"])),
            ordinal++,
          );
          if ((await input.peek()) === ",") await input.expect(",");
          else break;
        }
        await input.expect("]");
        out.set(name, { start, length: input.byteOffset - start });
      } else out.set(name, await legacySpan(input));
    } else await legacySpan(input);
    if ((await input.peek()) === ",") await input.expect(",");
    else break;
  }
  await input.expect("}");
  return out;
}
export type LegacyCase = { start: number; length: number; fields: Fields };
/** Captures offsets only; diagnostic offsets are spooled in a transaction-local table. */
export async function scanLegacyCase(
  tx: Transaction,
  input: StreamingJsonReader,
): Promise<LegacyCase> {
  await tx.execute(
    sql`CREATE TEMP TABLE IF NOT EXISTS quorem_legacy_case_diagnostics(ordinal integer,a integer,al integer,b integer,bl integer,c integer,cl integer) ON COMMIT DROP`,
  );
  await tx.execute(sql`TRUNCATE quorem_legacy_case_diagnostics`);
  await input.peek();
  const start = input.byteOffset;
  const values = await legacyFields(input, names, async (item, ordinal) => {
    const message = item.get("message"),
      line = item.get("line"),
      column = item.get("column");
    if (!message) throw new Error("Invalid diagnostic");
    await tx.execute(
      sql`INSERT INTO quorem_legacy_case_diagnostics VALUES(${ordinal},${message.start},${message.length},${line?.start ?? null},${line?.length ?? null},${column?.start ?? null},${column?.length ?? null})`,
    );
  });
  if (!values.has("index") || !values.has("status")) throw new Error("Invalid legacy case");
  return { start, length: input.byteOffset - start, fields: values };
}
/** Uses bytea slices, preserving NUL and numeric lexemes without returning case bytes to the Worker. */
export async function writeLegacyCase(
  tx: Transaction,
  id: string,
  channel: "public" | "sample" | "private",
  ordinal: number,
  item: LegacyCase,
): Promise<void> {
  const raw = legacyRaw;
  const text = (v: Span): SQL => sql`convert_from(${raw(v)},'UTF8')`;
  const kind = (v: Span): SQL => legacyKind(raw(v));
  const number = (v: Span): SQL => legacyInteger(raw(v));
  const clauses: SQL[] = [
    sql`json_typeof(convert_from(${raw(item)},'UTF8')::json)='object'`,
    number(item.fields.get("index")!),
    sql`${kind(item.fields.get("status")!)}='string'`,
  ];
  for (const name of ["stdout", "stderr"]) {
    const v = item.fields.get(name);
    if (v) clauses.push(sql`${kind(v)}='string'`);
  }
  const types = item.fields.get("sqlTypes");
  if (types)
    clauses.push(
      sql`${kind(types)}='array' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN ${kind(types)}='array' THEN replace(${text(types)},E'\\\\u0000',E'\\\\u0001')::jsonb ELSE '[]'::jsonb END) x WHERE jsonb_typeof(x)<>'string')`,
    );
  const diag = item.fields.get("diagnostics");
  if (diag) clauses.push(sql`${kind(diag)}='array'`);
  const parts: SQL[] = [sql`convert_to('{','UTF8')`];
  let comma = false;
  const append = (name: string, value: SQL) => {
    parts.push(sql`convert_to(${(comma ? "," : "") + JSON.stringify(name) + ":"},'UTF8')`, value);
    comma = true;
  };
  let diagData: SQL | undefined;
  if (diag) {
    const a = sql`substring(source.raw FROM x.a+1 FOR x.al)`,
      b = sql`substring(source.raw FROM x.b+1 FOR x.bl)`,
      c = sql`substring(source.raw FROM x.c+1 FOR x.cl)`;
    const kindBytes = legacyKind,
      intBytes = legacyInteger;
    clauses.push(
      sql`NOT EXISTS(SELECT 1 FROM quorem_legacy_case_diagnostics x WHERE NOT (${kindBytes(a)}='string' AND (x.b IS NULL OR ${intBytes(b)}) AND (x.c IS NULL OR ${intBytes(c)})))`,
    );
    const value = sql`convert_to('{','UTF8') || CASE WHEN x.c IS NULL THEN ''::bytea ELSE convert_to('"column":','UTF8') || ${c} || convert_to(',','UTF8') END || CASE WHEN x.b IS NULL THEN ''::bytea ELSE convert_to('"line":','UTF8') || ${b} || convert_to(',','UTF8') END || convert_to('"message":','UTF8') || ${a} || convert_to('}','UTF8')`;
    diagData = sql`convert_to('[','UTF8') || COALESCE((SELECT string_agg(${value},convert_to(',','UTF8') ORDER BY x.ordinal) FROM quorem_legacy_case_diagnostics x),''::bytea) || convert_to(']','UTF8')`;
  }
  for (const name of [
    "actual",
    "diagnostics",
    "expected",
    "index",
    "sqlTypes",
    "status",
    "stderr",
    "stdout",
  ]) {
    if (name === "diagnostics") {
      if (diagData) append(name, diagData);
      continue;
    }
    const v = item.fields.get(name);
    if (v) append(name, raw(v));
  }
  parts.push(sql`convert_to('}','UTF8')`);
  const source = legacySource(id, channel === "private" ? "private" : "public");
  const table =
    channel === "private"
      ? sql`interview_private_result_cases`
      : sql`submission_public_result_cases`;
  const columns =
    channel === "private"
      ? sql`submission_id,ordinal,result_data`
      : sql`submission_id,channel,ordinal,result_data`;
  const values =
    channel === "private"
      ? sql`${id}::uuid,${ordinal},data`
      : sql`${id}::uuid,${channel},${ordinal},data`;
  const filter =
    channel === "private"
      ? sql`submission_id=${id}::uuid AND ordinal=${ordinal}`
      : sql`submission_id=${id}::uuid AND channel=${channel} AND ordinal=${ordinal}`;
  const result = await tx.execute<{ ok: boolean; valid: boolean }>(
    sql`WITH source AS (${source}), projected AS (SELECT ${sql.join(parts, sql` || `)} AS data,(${sql.join(clauses, sql` AND `)}) AS valid FROM source), inserted AS (INSERT INTO ${table}(${columns}) SELECT ${values} FROM projected WHERE valid ON CONFLICT DO NOTHING RETURNING 1) SELECT EXISTS(SELECT 1 FROM inserted) OR EXISTS(SELECT 1 FROM ${table},projected WHERE ${filter} AND projected.valid AND result_data=projected.data) AS ok,COALESCE((SELECT valid FROM projected),false) AS valid`,
  );
  if (!result.rows[0]?.valid) throw new Error("Invalid legacy case");
  if (!result.rows[0]?.ok) throw new LegacyCaseConflict("Conflicting legacy case");
}
