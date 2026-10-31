/** @file retention.ts @description Bounded database retention batches. @module events */
import { sql, type SQL } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
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
    sql`DELETE FROM execution_checkpoints WHERE ctid IN (SELECT c.ctid FROM execution_checkpoints c JOIN execution_jobs j ON j.id=c.job_id JOIN submissions s ON s.id=j.submission_id JOIN users u ON u.id=s.owner_id WHERE s.state NOT IN ('queued','running') AND s.admitted_at < statement_timestamp()-CASE WHEN u.kind='guest' THEN interval '7 days' ELSE interval '30 days' END FOR UPDATE OF c SKIP LOCKED LIMIT ${limit})`,
    sql`UPDATE interview_execution SET private_results=NULL, private_results_payload=NULL WHERE ctid IN (SELECT e.ctid FROM interview_execution e JOIN submissions s ON s.id=e.submission_id JOIN users u ON u.id=s.owner_id WHERE s.state NOT IN ('queued','running') AND s.admitted_at < statement_timestamp()-CASE WHEN u.kind='guest' THEN interval '7 days' ELSE interval '30 days' END AND (e.private_results IS NOT NULL OR e.private_results_payload IS NOT NULL) FOR UPDATE OF e SKIP LOCKED LIMIT ${limit})`,
    sql`DELETE FROM guest_request_buckets WHERE ctid IN (SELECT ctid FROM guest_request_buckets WHERE window_start < statement_timestamp()-interval '2 hours' FOR UPDATE SKIP LOCKED LIMIT ${limit})`,
    sql`UPDATE submissions SET source='',result=NULL,cases='[]'::jsonb WHERE ctid IN (SELECT s.ctid FROM submissions s JOIN users u ON u.id=s.owner_id WHERE s.admitted_at < statement_timestamp()-interval '7 days' AND s.state NOT IN ('queued','running') AND u.kind='guest' AND (s.source<>'' OR s.result IS NOT NULL OR s.cases<>'[]'::jsonb) FOR UPDATE OF s SKIP LOCKED LIMIT ${limit})`,
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
  return changed;
}
