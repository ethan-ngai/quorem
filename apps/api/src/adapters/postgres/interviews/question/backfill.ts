/** @file backfill.ts @description Bounded privileged interview sidecar backfill. @module interviews */
import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import { backfillPrivateResultCases } from "./private-results.ts";
type Run = <T>(fn: (scope: Pick<ConnectionScope, "transaction">) => Promise<T>) => Promise<T>;
const opts = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
/** Operator-only primitive; the caller supplies a privileged scope and invokes bounded batches. */
export async function backfillInterviewPrivateResultsBatch(
  run: Run,
  limit = 16,
): Promise<{ attempted: number; completed: number }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
    throw new RangeError("Invalid backfill limit");
  let completed = 0;
  const results = await run((scope) =>
    scope.transaction(
      { ...opts, readOnly: true },
      async (tx) =>
        (
          await tx.execute<{ id: string }>(
            sql`SELECT e.submission_id::text AS id FROM interview_execution_public e JOIN submissions s ON s.id=e.submission_id AND s.state IN ('completed','failed','cancelled') WHERE ARRAY(SELECT c.ordinal FROM interview_private_result_cases c WHERE c.submission_id=e.submission_id ORDER BY c.ordinal) IS DISTINCT FROM ARRAY(SELECT generate_series(0,e.result_count-1)) ORDER BY e.submission_id LIMIT ${limit}`,
          )
        ).rows,
    ),
  );
  for (const row of results)
    if (
      await run((scope) => scope.transaction(opts, (tx) => backfillPrivateResultCases(tx, row.id)))
    )
      completed++;
  return { attempted: results.length, completed };
}
