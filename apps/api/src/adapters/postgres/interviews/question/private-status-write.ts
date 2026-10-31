/** @file private-status-write.ts @description Fenced private status mapping from the immutable interview snapshot. @module interviews */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";

/** Require the epoch's case IDs and order to match the submission's pinned fixture. */
export async function privateStatusMapping(tx: Transaction, submission: string): Promise<number> {
  const locked = await tx.execute(
    sql`SELECT i.id FROM interviews i JOIN interview_execution e ON e.session_id=i.id WHERE e.submission_id=${submission}::uuid FOR SHARE OF i`,
  );
  if (!locked.rows.length) throw new Error("Interview private case mapping unavailable");
  const row = (
    await tx.execute<{ valid: boolean; count: number }>(
      sql`SELECT q.private_ids=ARRAY(SELECT c.case_id FROM interview_question_private_cases c WHERE c.session_id=e.session_id AND c.question_epoch=e.question_epoch ORDER BY c.ordinal) AS valid,(SELECT count(*)::int FROM interview_question_private_cases c WHERE c.session_id=e.session_id AND c.question_epoch=e.question_epoch AND (c.case_id NOT LIKE 'level:%' OR split_part(c.case_id,':',2)::integer<=e.level)) AS count FROM interview_execution e JOIN interview_snapshot_public q ON q.session_id=e.session_id AND q.fixture_id=e.fixture_id WHERE e.submission_id=${submission}::uuid`,
    )
  ).rows[0];
  if (!row?.valid) throw new Error("Interview private case mapping unavailable");
  return row.count;
}
/** Verified completion statuses never derive from a runner-supplied status. */
export async function writeVerifiedPrivateStatuses(
  tx: Transaction,
  submission: string,
  job: string,
  count: number,
  fallback: boolean,
): Promise<void> {
  const available = await privateStatusMapping(tx, submission);
  const expected = fallback ? 0 : count;
  if (expected > available || (fallback && available !== 0))
    throw new Error("Interview private case mapping mismatch");
  await tx.execute(
    sql`INSERT INTO interview_private_status_headers(submission_id,status_count) VALUES(${submission}::uuid,${expected})`,
  );
  const inserted = await tx.execute<{ count: number }>(
    sql`WITH inserted AS (INSERT INTO interview_private_case_statuses(submission_id,ordinal,case_id,status_json,status_hash) SELECT ${submission}::uuid,f.ordinal,c.case_id,convert_to(to_json(f.status)::text,'UTF8'),sha256(convert_to(to_json(f.status)::text,'UTF8')) FROM execution_completion_frames f JOIN interview_execution e ON e.submission_id=${submission}::uuid JOIN interview_question_private_cases c ON c.session_id=e.session_id AND c.question_epoch=e.question_epoch AND c.ordinal=f.ordinal WHERE f.job_id=${job}::uuid AND f.channel='private' AND f.ordinal<${expected} RETURNING ordinal) SELECT count(*)::int AS count FROM inserted`,
  );
  if (inserted.rows[0].count !== expected)
    throw new Error("Interview private statuses unavailable");
}
