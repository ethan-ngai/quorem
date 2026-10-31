/** @file private-frame.ts @description Transactional private completion promotion. @module interviews */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
/** Copy a sealed frame only while its exact attempt remains live and locked by the caller. */
export async function savePrivateResultFrame(
  tx: Transaction,
  submissionId: string,
  jobId: string,
  attemptId: string,
  sandboxScope: string,
  ordinal: number,
): Promise<void> {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > 2147483646)
    throw new RangeError("Invalid private result ordinal");
  const source = sql`SELECT f.frame_data FROM execution_completion_frames f JOIN execution_completion_staging c ON c.job_id=f.job_id JOIN execution_jobs j ON j.id=c.job_id JOIN submissions s ON s.id=j.submission_id WHERE f.job_id=${jobId}::uuid AND f.channel='private' AND f.ordinal=${ordinal} AND c.attempt_id=${attemptId}::uuid AND c.sandbox_scope=${sandboxScope} AND c.eof AND j.submission_id=${submissionId}::uuid AND j.attempt_id=${attemptId}::uuid AND j.sandbox_scope=${sandboxScope} AND NOT j.finished AND j.lease_until>clock_timestamp() AND s.state='running'`;
  const result = await tx.execute<{ ok: boolean }>(
    sql`WITH source AS (${source}), inserted AS (INSERT INTO interview_private_result_cases(submission_id,ordinal,result_data) SELECT ${submissionId}::uuid,${ordinal},frame_data FROM source ON CONFLICT DO NOTHING RETURNING 1) SELECT EXISTS(SELECT 1 FROM inserted) OR EXISTS(SELECT 1 FROM source JOIN interview_private_result_cases r ON r.submission_id=${submissionId}::uuid AND r.ordinal=${ordinal} AND r.result_data=source.frame_data) AS ok`,
  );
  if (!result.rows[0]?.ok) throw new Error("Missing or conflicting private completion frame");
}
