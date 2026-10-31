/** @file field-validation.ts @description PostgreSQL-side validation for raw completion fields. @module judging */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";

/** Validates a NUL-preserving JSON copy inside PostgreSQL; it never returns the value to the Worker. */
export async function validateFieldChunks(
  tx: Transaction,
  jobId: string,
  channel: string,
  ordinal: number,
  outputLimit: number,
): Promise<Set<string>> {
  if (!Number.isSafeInteger(outputLimit) || outputLimit < 1)
    throw new Error("Invalid output limit");
  const rows = await tx.execute<{
    field: string;
    chunks: number;
    first: number;
    last: number;
    kind: string;
    size: number;
  }>(sql`
    WITH grouped AS (
      SELECT field,count(*)::int AS chunks,min(chunk_ordinal)::int AS first,max(chunk_ordinal)::int AS last,
             string_agg(chunk_data,''::bytea ORDER BY chunk_ordinal) AS data
      FROM execution_completion_field_chunks WHERE job_id=${jobId}::uuid AND channel=${channel} AND ordinal=${ordinal} GROUP BY field
    ) SELECT field,chunks,first,last,octet_length(data)::int AS size,json_typeof(convert_from(data,'UTF8')::json) AS kind FROM grouped`);
  const fields = new Set<string>();
  for (const row of rows.rows) {
    if (row.first !== 0 || row.last + 1 !== row.chunks) throw new Error("Incomplete field chunks");
    if ((row.field === "stdout" || row.field === "stderr") && row.kind !== "string")
      throw new Error("Invalid output field");
    if ((row.field === "diagnostics" || row.field === "sqlTypes") && row.kind !== "array")
      throw new Error("Invalid result list");
    if (row.field === "actual" && row.size > outputLimit)
      throw new Error("Result output exceeds limit");
    fields.add(row.field);
  }
  // JSONB cannot decode NUL; the validation copy replaces each NUL escape with a
  // same-width control character. Original raw bytes remain untouched.
  const checked = await tx.execute<{ field: string; valid: boolean }>(sql`
    WITH grouped AS (
      SELECT field,string_agg(chunk_data,''::bytea ORDER BY chunk_ordinal) AS data
      FROM execution_completion_field_chunks WHERE job_id=${jobId}::uuid AND channel=${channel} AND ordinal=${ordinal}
      AND field IN ('stdout','stderr','diagnostics','sqlTypes') GROUP BY field
    ), parsed AS (
      SELECT field,replace(convert_from(data,'UTF8'),E'\\\\u0000',E'\\\\u0001')::jsonb AS value FROM grouped
    ) SELECT field,CASE
      WHEN field IN ('stdout','stderr') THEN octet_length(value #>> '{}') <= ${outputLimit}
      WHEN field='sqlTypes' THEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value) item WHERE jsonb_typeof(item) <> 'string')
      ELSE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value) item WHERE
        jsonb_typeof(item) <> 'object' OR NOT (item ? 'message') OR jsonb_typeof(item->'message') <> 'string'
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(CASE WHEN jsonb_typeof(item)='object' THEN item ELSE '{}'::jsonb END) k WHERE k NOT IN ('message','line','column'))
        OR EXISTS(SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(item)='object' THEN item ELSE '{}'::jsonb END) e WHERE e.key IN ('line','column') AND
          (jsonb_typeof(e.value) <> 'number' OR e.value::text !~ '^(0|[1-9][0-9]*)$' OR
           CASE WHEN e.value::text ~ '^(0|[1-9][0-9]*)$' THEN e.value::text::numeric > 2147483647 ELSE false END))
      ) END AS valid FROM parsed`);
  if (checked.rows.some((row) => !row.valid)) throw new Error("Invalid result field");
  return fields;
}
