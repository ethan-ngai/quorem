/** @file backfill.ts @description Bounded privileged interview sidecar backfill. @module interviews */
import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import {
  backfillInterviewPublicExamples,
  backfillSnapshotPublicExamples,
} from "./public-examples.ts";
import { backfillPrivateResultCases } from "./private-results.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const opts = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
/** Operator-only primitive; the caller supplies a privileged scope and invokes bounded batches. */
export async function backfillInterviewBatch(
  run: Run,
  limit = 16,
): Promise<{ attempted: number; completed: number }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
    throw new RangeError("Invalid backfill limit");
  const active = await run((scope) =>
    scope.transaction(
      { ...opts, readOnly: true },
      async (tx) =>
        (
          await tx.execute<{ id: string; epoch: string }>(
            sql`SELECT i.id::text,i.question_epoch::text AS epoch FROM interviews i JOIN interview_question_public q ON q.session_id=i.id AND q.question_epoch=i.question_epoch WHERE ARRAY(SELECT x.level FROM interview_public_examples x WHERE x.session_id=i.id AND x.question_epoch=i.question_epoch ORDER BY x.level) IS DISTINCT FROM ARRAY(SELECT generate_series(0,CASE WHEN jsonb_typeof(q.metadata->'problem'->'odyssey'->'levels')='array' THEN jsonb_array_length(q.metadata->'problem'->'odyssey'->'levels') ELSE 0 END)) OR ARRAY(SELECT c.case_id FROM interview_question_private_cases c WHERE c.session_id=i.id AND c.question_epoch=i.question_epoch ORDER BY c.ordinal) IS DISTINCT FROM q.private_ids ORDER BY i.id LIMIT ${limit}`,
          )
        ).rows,
    ),
  );
  let completed = 0;
  for (const row of active)
    if (
      await run((scope) =>
        scope.transaction(opts, (tx) => backfillInterviewPublicExamples(tx, row.id, row.epoch)),
      )
    )
      completed++;
  const remaining = limit - active.length;
  const snapshots = remaining
    ? await run((scope) =>
        scope.transaction(
          { ...opts, readOnly: true },
          async (tx) =>
            (
              await tx.execute<{ id: string; fixture: Uint8Array }>(
                sql`SELECT q.session_id::text AS id,q.id AS fixture FROM interview_question_snapshots q WHERE ARRAY(SELECT e.level FROM interview_snapshot_public_examples e WHERE e.session_id=q.session_id AND e.fixture_id=q.id ORDER BY e.level) IS DISTINCT FROM ARRAY(SELECT generate_series(0,CASE WHEN jsonb_typeof(q.fixture->'problem'->'odyssey'->'levels')='array' THEN jsonb_array_length(q.fixture->'problem'->'odyssey'->'levels') ELSE 0 END)) OR EXISTS(SELECT 1 FROM interview_execution execution WHERE execution.session_id=q.session_id AND execution.fixture_id=q.id AND (SELECT count(*) FROM interview_question_private_cases c WHERE c.session_id=q.session_id AND c.question_epoch=execution.question_epoch) < CASE WHEN jsonb_typeof(q.fixture->'problem'->'odyssey'->'levels')='array' THEN COALESCE((SELECT sum(jsonb_array_length(CASE WHEN jsonb_typeof(suite)='array' THEN suite ELSE '[]'::jsonb END)) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(q.fixture->'odysseyHiddenCases')='array' THEN q.fixture->'odysseyHiddenCases' ELSE '[]'::jsonb END) suite),0) ELSE jsonb_array_length(CASE WHEN jsonb_typeof(q.fixture->'hiddenCases')='array' THEN q.fixture->'hiddenCases' ELSE '[]'::jsonb END) END) ORDER BY q.session_id,q.id LIMIT ${remaining}`,
              )
            ).rows,
        ),
      )
    : [];
  for (const row of snapshots)
    if (
      await run((scope) =>
        scope.transaction(opts, (tx) => backfillSnapshotPublicExamples(tx, row.id, row.fixture)),
      )
    )
      completed++;
  const available = remaining - snapshots.length;
  const results = available
    ? await run((scope) =>
        scope.transaction(
          { ...opts, readOnly: true },
          async (tx) =>
            (
              await tx.execute<{ id: string }>(
                sql`SELECT e.submission_id::text AS id FROM interview_execution_public e JOIN submissions s ON s.id=e.submission_id AND s.state IN ('completed','failed','cancelled') WHERE ARRAY(SELECT c.ordinal FROM interview_private_result_cases c WHERE c.submission_id=e.submission_id ORDER BY c.ordinal) IS DISTINCT FROM ARRAY(SELECT generate_series(0,e.result_count-1)) ORDER BY e.submission_id LIMIT ${available}`,
              )
            ).rows,
        ),
      )
    : [];
  for (const row of results)
    if (
      await run((scope) => scope.transaction(opts, (tx) => backfillPrivateResultCases(tx, row.id)))
    )
      completed++;
  return { attempted: active.length + snapshots.length + results.length, completed };
}
