/** @file status-backfill.ts @description Bounded operator repair of retained public case statuses. @module judging */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { decodeUtf8Chunks, readAllowedObjectSpans, StreamingJsonReader } from "@quorem/questions";
const fields = new Set([
  "actual",
  "diagnostics",
  "expected",
  "index",
  "sqlTypes",
  "status",
  "stderr",
  "stdout",
]);
/** Locks one retained submission, then scans one immutable case by byte pages. */
export async function backfillOnePublicStatus(
  tx: Transaction,
  submissionId?: string,
): Promise<boolean> {
  const parent = (
    await tx.execute<{ id: string }>(
      sql`SELECT s.id::text FROM submissions s WHERE s.state IN ('completed','failed','cancelled') AND s.result IS NOT NULL AND (${submissionId ?? null}::uuid IS NULL OR s.id=${submissionId ?? null}::uuid) AND EXISTS(SELECT 1 FROM submission_public_result_cases c WHERE c.submission_id=s.id AND NOT EXISTS(SELECT 1 FROM submission_public_case_statuses x WHERE x.submission_id=c.submission_id AND x.channel=c.channel AND x.ordinal=c.ordinal)) ORDER BY s.id FOR UPDATE OF s SKIP LOCKED LIMIT 1`,
    )
  ).rows[0];
  if (!parent) return false;
  const row = (
    await tx.execute<{ channel: string; ordinal: number }>(
      sql`SELECT c.channel,c.ordinal FROM submission_public_result_cases c WHERE c.submission_id=${parent.id}::uuid AND NOT EXISTS(SELECT 1 FROM submission_public_case_statuses x WHERE x.submission_id=c.submission_id AND x.channel=c.channel AND x.ordinal=c.ordinal) ORDER BY c.channel,c.ordinal FOR UPDATE OF c LIMIT 1`,
    )
  ).rows[0];
  if (!row) throw new Error("Status backfill changed");
  async function* pages() {
    let offset = 1;
    for (;;) {
      const page = (
        await tx.execute<{ bytes: Uint8Array }>(
          sql`SELECT substring(result_data FROM ${offset} FOR 65536) AS bytes FROM submission_public_result_cases WHERE submission_id=${parent.id}::uuid AND channel=${row.channel} AND ordinal=${row.ordinal}`,
        )
      ).rows[0];
      if (!page) throw new Error("Status source unavailable");
      yield page.bytes;
      if (page.bytes.length < 65536) break;
      offset += page.bytes.length;
    }
  }
  const reader = new StreamingJsonReader(decodeUtf8Chunks(pages())[Symbol.asyncIterator]());
  const spans = await readAllowedObjectSpans(reader, fields);
  const status = spans.get("status"),
    index = spans.get("index");
  if (!status || !index) throw new Error("Missing public case status");
  await tx.execute(sql`SELECT set_config('quorem.result_backfill','v1',true)`);
  const inserted = await tx.execute(
    sql`INSERT INTO submission_public_case_statuses(submission_id,channel,ordinal,case_index,status_json,status_hash) SELECT submission_id,channel,ordinal,convert_from(substring(result_data FROM ${index.start + 1} FOR ${index.length}),'UTF8')::integer,substring(result_data FROM ${status.start + 1} FOR ${status.length}),sha256(substring(result_data FROM ${status.start + 1} FOR ${status.length})) FROM submission_public_result_cases WHERE submission_id=${parent.id}::uuid AND channel=${row.channel} AND ordinal=${row.ordinal} ON CONFLICT DO NOTHING RETURNING ordinal`,
  );
  if (!inserted.rows.length) throw new Error("Status backfill conflict");
  return true;
}
/** A locked row is still pending; it must not be reported as a completed cutover. */
export async function publicStatusBackfillPending(tx: Transaction): Promise<boolean> {
  return (
    await tx.execute<{ pending: boolean }>(
      sql`SELECT EXISTS(SELECT 1 FROM submissions s JOIN submission_public_result_cases c ON c.submission_id=s.id WHERE s.state IN ('completed','failed','cancelled') AND s.result IS NOT NULL AND NOT EXISTS(SELECT 1 FROM submission_public_case_statuses x WHERE x.submission_id=c.submission_id AND x.channel=c.channel AND x.ordinal=c.ordinal)) AS pending`,
    )
  ).rows[0].pending;
}
/** Each bounded operator transaction repairs one row; no network occurs under its lock. */
export async function backfillPublicStatusBatch(
  run: <T>(fn: (scope: Pick<ConnectionScope, "transaction">) => Promise<T>) => Promise<T>,
  limit = 16,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
    throw new RangeError("Invalid status batch");
  let count = 0;
  while (count < limit) {
    const found = await run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 30000, lockTimeoutMs: 1000 },
        backfillOnePublicStatus,
      ),
    );
    if (!found) break;
    count++;
  }
  return count;
}
