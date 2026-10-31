/** @file retention.ts @description Bounded database retention batches. @module events */
import { sql, type SQL } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const outboxes = [
  "interview_outbox",
  "match_outbox",
  "submission_outbox",
  "membership_outbox",
] as const;
/** Run only from trusted maintenance composition; no public invocation endpoint. */
export async function retainBatch(run: Run, limit = 128): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256)
    throw new RangeError("Invalid retention batch");
  const statements: SQL[] = outboxes.map((name) => {
    const table = sql.raw(name);
    return sql`DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} WHERE published_at IS NOT NULL AND occurred_at < statement_timestamp()-interval '7 days' ORDER BY occurred_at,sequence FOR UPDATE SKIP LOCKED LIMIT ${limit})`;
  });
  statements.push(
    sql`DELETE FROM execution_jobs WHERE id IN (SELECT j.id FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id JOIN users u ON u.id=s.owner_id WHERE j.finished AND j.lease_until IS NULL AND s.state IN ('completed','failed','cancelled') AND s.admitted_at < statement_timestamp()-CASE WHEN u.kind='guest' THEN interval '7 days' ELSE interval '30 days' END ORDER BY s.admitted_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT ${limit})`,
    sql`DELETE FROM execution_checkpoints WHERE ctid IN (SELECT c.ctid FROM execution_checkpoints c JOIN execution_jobs j ON j.id=c.job_id JOIN submissions s ON s.id=j.submission_id JOIN users u ON u.id=s.owner_id WHERE s.state NOT IN ('queued','running') AND s.admitted_at < statement_timestamp()-CASE WHEN u.kind='guest' THEN interval '7 days' ELSE interval '30 days' END FOR UPDATE OF c SKIP LOCKED LIMIT ${limit})`,
    sql`UPDATE interview_execution SET private_results=NULL, private_results_payload=NULL WHERE ctid IN (SELECT e.ctid FROM interview_execution e JOIN submissions s ON s.id=e.submission_id JOIN users u ON u.id=s.owner_id WHERE s.state NOT IN ('queued','running') AND s.admitted_at < statement_timestamp()-CASE WHEN u.kind='guest' THEN interval '7 days' ELSE interval '30 days' END AND (e.private_results IS NOT NULL OR e.private_results_payload IS NOT NULL) FOR UPDATE OF e SKIP LOCKED LIMIT ${limit})`,
    sql`DELETE FROM guest_request_buckets WHERE ctid IN (SELECT ctid FROM guest_request_buckets WHERE window_start < statement_timestamp()-interval '2 hours' FOR UPDATE SKIP LOCKED LIMIT ${limit})`,
    sql`UPDATE submissions SET source='',result=NULL,result_payload=NULL,cases='[]'::jsonb,lossless_cases=NULL WHERE ctid IN (SELECT s.ctid FROM submissions s JOIN users u ON u.id=s.owner_id WHERE s.admitted_at < statement_timestamp()-interval '7 days' AND s.state NOT IN ('queued','running') AND u.kind='guest' AND (s.source<>'' OR s.result IS NOT NULL OR s.result_payload IS NOT NULL OR s.cases<>'[]'::jsonb OR s.lossless_cases IS NOT NULL) FOR UPDATE OF s SKIP LOCKED LIMIT ${limit})`,
    sql`UPDATE users SET display_name='Expired guest' WHERE ctid IN (SELECT u.ctid FROM users u WHERE u.kind='guest' AND u.display_name<>'Expired guest' AND EXISTS (SELECT 1 FROM guest_sessions g WHERE g.owner_id=u.id AND g.expires_at<statement_timestamp()-interval '7 days') FOR UPDATE OF u SKIP LOCKED LIMIT ${limit})`,
    ...["execution_idempotency", "cancellation_idempotency", "match_idempotency"].map((name) => {
      const table = sql.raw(name);
      return sql`DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} WHERE expires_at < statement_timestamp() FOR UPDATE SKIP LOCKED LIMIT ${limit})`;
    }),
    sql`UPDATE submissions SET source='',result=NULL,cases=CASE WHEN lossless_cases IS NULL THEN cases ELSE '[]'::jsonb END,lossless_cases=NULL WHERE ctid IN (SELECT ctid FROM submissions WHERE admitted_at < statement_timestamp()-interval '30 days' AND state NOT IN ('queued','running') AND (source<>'' OR result IS NOT NULL OR lossless_cases IS NOT NULL) FOR UPDATE SKIP LOCKED LIMIT ${limit})`,
  );
  let changed = 0;
  for (const statement of statements)
    changed += await run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 5000, lockTimeoutMs: 1000 },
        async (tx) => (await tx.execute(statement)).rowCount ?? 0,
      ),
    );
  const collected = await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
      collectInputBlobs(tx, 4096, Math.min(limit, 128)),
    ),
  );
  return changed + collected.deleted;
}

/** Advance one serialized keyset page; locks and cursor commit with the deletions. */
export async function collectInputBlobs(
  tx: Transaction,
  scanLimit = 4096,
  deleteLimit = 128,
): Promise<{ examined: number; deleted: number; wrapped: boolean }> {
  if (
    !Number.isSafeInteger(scanLimit) ||
    scanLimit < 1 ||
    scanLimit > 4096 ||
    !Number.isSafeInteger(deleteLimit) ||
    deleteLimit < 1 ||
    deleteLimit > 128
  )
    throw new RangeError("Invalid collection budget");
  const row = (
    await tx.execute<{ examined: number; deleted: number; wrapped: boolean }>(sql`
    WITH state AS MATERIALIZED (SELECT cursor FROM runner_input_gc_state WHERE id=1 FOR UPDATE SKIP LOCKED),
    candidates AS MATERIALIZED (SELECT b.hash FROM runner_input_blobs b,state WHERE b.hash>COALESCE(state.cursor,''::bytea) ORDER BY b.hash FOR UPDATE OF b SKIP LOCKED LIMIT ${scanLimit}),
    eligible AS MATERIALIZED (SELECT c.hash FROM candidates c WHERE
      (SELECT 1 FROM runner_version_inputs x WHERE x.metadata_hash=c.hash LIMIT 1) IS NULL AND
      (SELECT 1 FROM runner_snapshot_inputs x WHERE x.metadata_hash=c.hash LIMIT 1) IS NULL AND
      (SELECT 1 FROM runner_version_input_cases x WHERE x.blob_hash=c.hash LIMIT 1) IS NULL AND
      (SELECT 1 FROM runner_snapshot_input_cases x WHERE x.blob_hash=c.hash LIMIT 1) IS NULL AND
      (SELECT 1 FROM runner_job_inputs x WHERE x.metadata_hash=c.hash LIMIT 1) IS NULL AND
      (SELECT 1 FROM runner_job_inputs x WHERE x.source_hash=c.hash LIMIT 1) IS NULL AND
      (SELECT 1 FROM runner_job_input_cases x WHERE x.blob_hash=c.hash LIMIT 1) IS NULL ORDER BY c.hash LIMIT ${deleteLimit}),
    deleted AS (DELETE FROM runner_input_blobs b USING eligible e WHERE b.hash=e.hash RETURNING b.hash),
    advanced AS (UPDATE runner_input_gc_state SET cursor=CASE WHEN (SELECT count(*) FROM eligible)=${deleteLimit} THEN (SELECT hash FROM eligible ORDER BY hash DESC LIMIT 1) ELSE (SELECT hash FROM candidates ORDER BY hash DESC LIMIT 1) END WHERE id=1 AND EXISTS(SELECT 1 FROM state) RETURNING cursor)
    SELECT (SELECT count(*)::int FROM candidates) AS examined,(SELECT count(*)::int FROM deleted) AS deleted,(SELECT cursor IS NULL FROM advanced) AS wrapped
  `)
  ).rows[0];
  return row?.wrapped === null ? { examined: 0, deleted: 0, wrapped: false } : row;
}
