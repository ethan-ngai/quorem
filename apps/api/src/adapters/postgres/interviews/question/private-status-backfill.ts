/** @file private-status-backfill.ts @description Bounded repair of epoch-bound private feedback. @module interviews */
import { sql, type SQL } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { decodeUtf8Chunks, readAllowedObjectSpans, StreamingJsonReader } from "@quorem/questions";
import { backfillPrivateResultCases } from "./private-results.ts";
import { privateStatusMapping } from "./private-status-write.ts";

const allowed = new Set([
  "index",
  "status",
  "actual",
  "expected",
  "stdout",
  "stderr",
  "diagnostics",
  "sqlTypes",
]);
/** Lock the retained source and derive case IDs only from the pinned fixture's validated order. */
export async function backfillOnePrivateStatus(
  tx: Transaction,
  submission?: string,
): Promise<boolean> {
  const parent = (
    await tx.execute<{ id: string }>(
      sql`SELECT s.id::text FROM submissions s JOIN interview_execution e ON e.submission_id=s.id WHERE s.kind='submit' AND s.state='completed' AND s.result IS NOT NULL AND (${submission ?? null}::uuid IS NULL OR s.id=${submission ?? null}::uuid) AND NOT EXISTS(SELECT 1 FROM interview_private_status_headers h WHERE h.submission_id=s.id) ORDER BY s.id FOR UPDATE OF s,e SKIP LOCKED LIMIT 1`,
    )
  ).rows[0];
  if (!parent) return false;
  const available = await privateStatusMapping(tx, parent.id);
  await backfillPrivateResultCases(tx, parent.id);
  const total = (
    await tx.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM interview_private_result_cases WHERE submission_id=${parent.id}::uuid`,
    )
  ).rows[0].n;
  await tx.execute(
    sql`CREATE TEMP TABLE IF NOT EXISTS quorem_private_status_spans(ordinal integer NOT NULL,case_id text NOT NULL,status_json bytea NOT NULL) ON COMMIT DROP`,
  );
  await tx.execute(sql`TRUNCATE quorem_private_status_spans`);
  let count = 0;
  async function* chunks(source: SQL): AsyncGenerator<Uint8Array> {
    for (let offset = 1; ; offset += 65536) {
      const value = (
        await tx.execute<{ bytes: Uint8Array }>(
          sql`SELECT substring(data FROM ${offset} FOR 65536) AS bytes FROM (${source}) source`,
        )
      ).rows[0];
      if (!value?.bytes) throw new Error("Private status source unavailable");
      yield value.bytes;
      if (value.bytes.length < 65536) return;
    }
  }
  async function save(
    source: SQL,
    index: { start: number; length: number },
    status: { start: number; length: number },
  ): Promise<void> {
    const rawIndex = sql`substring(data FROM ${index.start + 1} FOR ${index.length})`;
    const rawStatus = sql`substring(data FROM ${status.start + 1} FOR ${status.length})`;
    const result = await tx.execute(
      sql`INSERT INTO quorem_private_status_spans(ordinal,case_id,status_json) SELECT c.ordinal,c.case_id,${rawStatus} FROM (${source}) src JOIN interview_execution e ON e.submission_id=${parent.id}::uuid JOIN interview_question_private_cases c ON c.session_id=e.session_id AND c.question_epoch=e.question_epoch AND c.ordinal=CASE WHEN json_typeof(convert_from(${rawIndex},'UTF8')::json)='number' AND convert_from(${rawIndex},'UTF8') ~ '^(0|[1-9][0-9]*)$' AND length(convert_from(${rawIndex},'UTF8'))<=10 AND convert_from(${rawIndex},'UTF8')::numeric<=2147483647 THEN convert_from(${rawIndex},'UTF8')::integer ELSE -1 END WHERE (c.case_id NOT LIKE 'level:%' OR split_part(c.case_id,':',2)::integer<=e.level) AND json_typeof(convert_from(${rawStatus},'UTF8')::json)='string' RETURNING ordinal`,
    );
    if (result.rows.length !== 1) throw new Error("Invalid private status mapping");
    count++;
  }
  if (total) {
    for (let ordinal = 0; ordinal < total; ordinal++) {
      const source = sql`SELECT result_data AS data FROM interview_private_result_cases WHERE submission_id=${parent.id}::uuid AND ordinal=${ordinal}`;
      const reader = new StreamingJsonReader(
        decodeUtf8Chunks(chunks(source))[Symbol.asyncIterator](),
      );
      const fields = await readAllowedObjectSpans(reader, allowed);
      const index = fields.get("index"),
        status = fields.get("status");
      if (!index || !status) throw new Error("Private result status unavailable");
      await save(source, index, status);
    }
  } else {
    const source = sql`SELECT field_data AS data FROM submission_result_header_fields WHERE submission_id=${parent.id}::uuid AND field='hiddenCases'`;
    const found = (await tx.execute(sql`SELECT 1 FROM (${source}) s`)).rows.length > 0;
    if (found) {
      const reader = new StreamingJsonReader(
        decodeUtf8Chunks(chunks(source))[Symbol.asyncIterator](),
      );
      await reader.expect("[");
      while ((await reader.peek()) !== "]") {
        const fields = await readAllowedObjectSpans(reader, new Set(["index", "status"]), false);
        const index = fields.get("index"),
          status = fields.get("status");
        if (!index || !status) throw new Error("Private status unavailable");
        await save(source, index, status);
        if ((await reader.peek()) === ",") await reader.expect(",");
        else break;
      }
      await reader.expect("]");
      if (await reader.peek()) throw new Error("Invalid private status source");
    } else if (available) throw new Error("Private status source unavailable");
  }
  if (count > available) throw new Error("Private status mapping mismatch");
  const distinct = (
    await tx.execute<{ n: number }>(
      sql`SELECT count(DISTINCT case_id)::int AS n FROM quorem_private_status_spans`,
    )
  ).rows[0].n;
  if (distinct !== count) throw new Error("Duplicate private status");
  await tx.execute(sql`SELECT set_config('quorem.result_backfill','v1',true)`);
  await tx.execute(
    sql`INSERT INTO interview_private_status_headers(submission_id,status_count) VALUES(${parent.id}::uuid,${count})`,
  );
  await tx.execute(
    sql`INSERT INTO interview_private_case_statuses(submission_id,ordinal,case_id,status_json,status_hash) SELECT ${parent.id}::uuid,ordinal,case_id,status_json,sha256(status_json) FROM quorem_private_status_spans`,
  );
  return true;
}
export async function privateStatusPending(tx: Transaction): Promise<boolean> {
  return (
    await tx.execute<{ pending: boolean }>(
      sql`SELECT EXISTS(SELECT 1 FROM submissions s JOIN interview_execution e ON e.submission_id=s.id WHERE s.kind='submit' AND s.state='completed' AND s.result IS NOT NULL AND NOT EXISTS(SELECT 1 FROM interview_private_status_headers h WHERE h.submission_id=s.id)) AS pending`,
    )
  ).rows[0].pending;
}
export async function backfillOnePrivateStatusRun(
  run: <T>(f: (s: Pick<ConnectionScope, "transaction">) => Promise<T>) => Promise<T>,
): Promise<boolean> {
  return run((s) =>
    s.transaction({ statementTimeoutMs: 30000, lockTimeoutMs: 1000 }, backfillOnePrivateStatus),
  );
}
