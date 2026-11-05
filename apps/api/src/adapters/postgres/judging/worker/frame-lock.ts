/** Per-frame writers share parent fences; attempt transitions retain exclusive parent locks. */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import type { Job } from "@quorem/execution";

export async function lockCompletionFrame(
  tx: Transaction,
  job: Job,
  channel: string,
  ordinal: number,
): Promise<void> {
  const key = `completion-frame:${job.jobId}:${channel}:${ordinal}`;
  const rows = await tx.execute(
    sql`SELECT j.id,pg_advisory_xact_lock(hashtextextended(${key},0))
      FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id
      JOIN execution_completion_staging st ON st.job_id=j.id
      WHERE j.id=${job.jobId}::uuid AND s.id=${job.submissionId}::uuid
        AND j.attempt_id=${job.attemptId}::uuid AND j.sandbox_scope=${job.sandboxScope}
        AND st.attempt_id=j.attempt_id AND st.sandbox_scope=j.sandbox_scope AND NOT st.eof
      FOR SHARE OF j,s,st`,
  );
  if (!rows.rows.length) throw new Error("Stale completion");
  // Lease/cancellation may change while acquiring the locks; sample the wall clock afterward.
  const live = await tx.execute<{ live: boolean }>(
    sql`SELECT NOT j.finished AND j.lease_until>clock_timestamp()
      AND s.state='running' AND NOT s.cancel_requested AS live
      FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id
      WHERE j.id=${job.jobId}::uuid`,
  );
  if (!live.rows[0]?.live) throw new Error("Stale completion");
}
