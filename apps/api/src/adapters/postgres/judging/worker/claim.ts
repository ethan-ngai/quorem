import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import {
  assertClaimFence,
  encodeJob,
  runtimeForRevision,
  type AttemptFence,
  type Job,
} from "@quorem/execution";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
export interface RunnerCapabilities {
  resumable: boolean;
  losslessCases: boolean;
  losslessResults: boolean;
}
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
const eligible = sql`NOT j.finished AND s.state IN ('queued','running')`;
function scopeValid(scope: string): void {
  if (
    !scope ||
    new TextEncoder().encode(scope).length > 256 ||
    Array.from(scope).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error("Invalid sandbox scope");
}
function gates(cap: RunnerCapabilities) {
  return sql`${cap.resumable} OR NOT EXISTS(SELECT 1 FROM execution_checkpoints c WHERE c.job_id=j.id)`;
}
function lossless(cap: RunnerCapabilities) {
  return sql`${cap.losslessCases && cap.losslessResults} OR (s.lossless_cases IS NULL AND p.lossless_fixture IS NULL AND q.lossless_fixture IS NULL)`;
}
const joins = sql`FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN problem_versions p ON p.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id`;
export function postgresClaims(run: Run, cap: RunnerCapabilities) {
  return {
    async nextExpiredAttempt(resumable: boolean, scope: string): Promise<AttemptFence | null> {
      scopeValid(scope);
      if (resumable !== cap.resumable) throw new Error("Capability mismatch");
      return run((scopeDb) =>
        scopeDb.transaction({ ...options, readOnly: true }, async (tx) => {
          const row = (
            await tx.execute<{ attempt: string; scope: string }>(
              sql`SELECT j.attempt_id::text AS attempt,j.sandbox_scope AS scope ${joins} WHERE ${eligible} AND (${gates(cap)}) AND (${lossless(cap)}) AND j.available_at<=clock_timestamp() AND j.attempt_id IS NOT NULL AND j.lease_until<clock_timestamp() AND j.sandbox_scope=${scope} ORDER BY j.available_at,j.id LIMIT 1`,
            )
          ).rows[0];
          return row ? { attemptId: row.attempt, sandboxScope: row.scope } : null;
        }),
      );
    },
    async claimAfterTeardown(
      resumable: boolean,
      scope: string,
      proof: AttemptFence | null,
    ): Promise<Job | null> {
      scopeValid(scope);
      if (resumable !== cap.resumable) throw new Error("Capability mismatch");
      assertClaimFence(scope, proof);
      return run((scopeDb) =>
        scopeDb.transaction(options, async (tx) => {
          if (cap.resumable)
            await tx.execute(sql`SELECT set_config('quorem.checkpoint_claim','v1',true)`);
          if (cap.losslessCases && cap.losslessResults)
            await tx.execute(sql`SELECT set_config('quorem.lossless_case_claim','v1',true)`);
          await tx.execute(sql`SELECT set_config('quorem.sandbox_scope',${scope},true)`);
          await tx.execute(sql`SELECT pg_advisory_xact_lock(740020)`);
          const row = (
            await tx.execute<{
              job: string;
              submission: string;
              problem: string;
              suite: string;
              limits: unknown;
              cancelled: boolean;
              attempts: number;
              language: string;
              revision: string;
              harness: string;
              previous: string | null;
            }>(
              sql`SELECT j.id::text AS job,j.submission_id::text AS submission,COALESCE(q.fixture->'problem'->>'id',w.problem_version_id::text) AS problem,COALESCE(q.fixture->'problem'->>'id',p.id::text) AS suite,COALESCE(q.fixture->'problem'->'limits',p.limits) AS limits,s.cancel_requested AS cancelled,j.attempts,j.language,j.runtime_revision AS revision,j.harness_revision AS harness,j.attempt_id::text AS previous ${joins} WHERE ${eligible} AND (${gates(cap)}) AND (${lossless(cap)}) AND j.available_at<=clock_timestamp() AND (j.lease_until IS NULL OR j.lease_until<clock_timestamp()) AND (j.attempt_id IS NULL OR (j.attempt_id=${proof?.attemptId ?? null}::uuid AND j.sandbox_scope=${scope})) ORDER BY j.available_at,j.id FOR UPDATE OF j,s SKIP LOCKED LIMIT 1`,
            )
          ).rows[0];
          if (!row) return null;
          if (row.previous)
            await tx.execute(sql`SELECT set_config('quorem.reaped_attempt',${row.previous},true)`);
          if (row.cancelled) {
            await tx.execute(
              sql`UPDATE submissions SET state='cancelled',updated_at=clock_timestamp() WHERE id=${row.submission}::uuid`,
            );
            await tx.execute(
              sql`UPDATE execution_jobs SET finished=true,attempt_id=NULL,lease_until=NULL WHERE id=${row.job}::uuid`,
            );
            return null;
          }
          if (row.attempts >= 3) {
            await tx.execute(
              sql`UPDATE submissions SET state='failed',result='{"infrastructureError":"Judge unavailable"}'::jsonb,updated_at=clock_timestamp() WHERE id=${row.submission}::uuid`,
            );
            await tx.execute(
              sql`UPDATE execution_jobs SET finished=true,attempt_id=NULL,lease_until=NULL WHERE id=${row.job}::uuid`,
            );
            return null;
          }
          const runtime = runtimeForRevision(row.revision, row.harness);
          if (!runtime || runtime.language !== row.language)
            throw new Error("Unsupported execution runtime");
          const result: Job = {
            jobId: row.job,
            submissionId: row.submission,
            attemptId: crypto.randomUUID(),
            sandboxScope: scope,
            problemVersionId: row.problem,
            sourceRef: row.submission,
            suiteRef: row.suite,
            language: row.language,
            runtimeRevision: row.revision,
            harnessRevision: row.harness,
            limits: row.limits as Job["limits"],
          };
          encodeJob(result);
          await tx.execute(
            sql`UPDATE execution_jobs SET attempt_id=${result.attemptId}::uuid,attempts=attempts+1,lease_until=clock_timestamp()+interval '90 seconds' WHERE id=${row.job}::uuid`,
          );
          await tx.execute(
            sql`UPDATE submissions SET state='running',updated_at=clock_timestamp() WHERE id=${row.submission}::uuid`,
          );
          return result;
        }),
      );
    },
    async lease(job: Job, heartbeat: boolean): Promise<boolean> {
      scopeValid(job.sandboxScope);
      return run((scopeDb) =>
        scopeDb.transaction(options, async (tx) => {
          const locked = await tx.execute(
            sql`SELECT j.id FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=${job.jobId}::uuid AND s.id=${job.submissionId}::uuid FOR UPDATE OF j,s`,
          );
          if (!locked.rows.length) return false;
          const row = (
            await tx.execute<{ live: boolean }>(
              sql`SELECT NOT j.finished AND j.attempt_id=${job.attemptId}::uuid AND j.sandbox_scope=${job.sandboxScope} AND j.lease_until>clock_timestamp() AND s.state='running' AND NOT s.cancel_requested AS live FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=${job.jobId}::uuid AND s.id=${job.submissionId}::uuid`,
            )
          ).rows[0];
          if (!row?.live) return false;
          if (heartbeat)
            await tx.execute(
              sql`UPDATE execution_jobs SET lease_until=clock_timestamp()+interval '90 seconds' WHERE id=${job.jobId}::uuid`,
            );
          return true;
        }),
      );
    },
  };
}
