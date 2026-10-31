/** @file legacy-sql.ts @description PostgreSQL validation of lossless raw JSON ranges. @module judging */
import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import type { Span } from "./legacy-case.ts";
export const legacyRaw = (value: Span): SQL =>
  sql`substring(source.raw FROM ${value.start + 1} FOR ${value.length})`;
export const legacyKind = (value: SQL): SQL =>
  sql`json_typeof(convert_from(${value},'UTF8')::json)`;
export const legacyInteger = (value: SQL): SQL =>
  sql`(${legacyKind(value)}='number' AND convert_from(${value},'UTF8') ~ '^(0|[1-9][0-9]*)$' AND CASE WHEN convert_from(${value},'UTF8') ~ '^(0|[1-9][0-9]*)$' THEN convert_from(${value},'UTF8')::numeric <= 2147483647 ELSE false END)`;

/** Keep one uncompressed, transaction-local copy so byte slices avoid repeated TOAST decompression. */
export async function spoolLegacySource(
  tx: Transaction,
  id: string,
  kind: "public" | "private",
): Promise<void> {
  await tx.execute(
    sql`CREATE TEMP TABLE IF NOT EXISTS quorem_legacy_source(id uuid NOT NULL,kind text NOT NULL,raw bytea,PRIMARY KEY(id,kind)) ON COMMIT DROP`,
  );
  await tx.execute(sql`ALTER TABLE quorem_legacy_source ALTER COLUMN raw SET STORAGE EXTERNAL`);
  const source =
    kind === "private"
      ? sql`SELECT substring(COALESCE(private_results_payload,convert_to(private_results::text,'UTF8')) FROM 1) FROM interview_execution WHERE submission_id=${id}::uuid`
      : sql`SELECT substring(COALESCE(result_payload,convert_to(result::text,'UTF8')) FROM 1) FROM submissions WHERE id=${id}::uuid`;
  await tx.execute(
    sql`INSERT INTO quorem_legacy_source(id,kind,raw) SELECT ${id}::uuid,${kind},source.raw FROM (${source}) AS source(raw) ON CONFLICT(id,kind) DO UPDATE SET raw=EXCLUDED.raw`,
  );
}
export const legacySource = (id: string, kind: "public" | "private"): SQL =>
  sql`SELECT raw FROM quorem_legacy_source WHERE id=${id}::uuid AND kind=${kind}`;
