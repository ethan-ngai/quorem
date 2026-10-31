import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import {
  compressCheckpointFrame,
  decompressCheckpointFrame,
  decodeJudgeFrame,
  encodeCheckpointCase,
  assertAttemptFence,
  type Checkpoint,
  type CheckpointCase,
  type Job,
} from "@quorem/execution";
import {
  compareCodingCase,
  compareSqlResult,
  parseLosslessJson,
  stringifyLosslessJson,
  validateCodingCase,
  validateCodingSequence,
  validateSqlCase,
  type JsonValue,
  type QuestionProblem,
  type Signature,
} from "@quorem/questions";
import { reconcileMatch } from "../../matches/reconcile/repository.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
function object(value: JsonValue): { [key: string]: JsonValue } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid case");
  return value as { [key: string]: JsonValue };
}
/** Private admitted case comparison remains conservative if any trusted data is malformed. */
async function matchFailure(
  tx: Transaction,
  job: Job,
  item: CheckpointCase,
): Promise<string | null> {
  const row = (
    await tx.execute<{ match: string; case: string; problem: string; level: number | null }>(
      sql`SELECT s.match_id::text AS match,(s.cases->${item.ordinal}::int)::text AS "case",jsonb_build_object('signature',v.signature,'constraints',v.constraints,'odyssey',v.odyssey,'sql',v.sql_config,'limits',v.limits)::text AS problem,s.odyssey_level AS level FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id JOIN workspaces w ON w.id=s.workspace_id JOIN problem_versions v ON v.id=w.problem_version_id WHERE j.id=${job.jobId}::uuid AND s.id=${job.submissionId}::uuid AND s.match_id IS NOT NULL AND s.kind='submit' AND s.lossless_cases IS NULL AND ${item.ordinal}<jsonb_array_length(s.cases)`,
    )
  ).rows[0];
  if (!row || !row.case || row.case === "null") return null;
  try {
    const problem = JSON.parse(row.problem) as QuestionProblem,
      frame = decodeJudgeFrame(item.frame);
    if (
      ![
        "executed",
        "syntax_error",
        "runtime_error",
        "time_limit",
        "memory_limit",
        "output_limit",
        "invalid_output",
      ].includes(frame.status)
    )
      return null;
    const stages = problem.odyssey?.levels ?? [];
    if (stages.length && (!row.level || row.level < 1 || row.level > stages.length)) return null;
    const methods: Signature[] = stages.slice(0, row.level ?? 0).flatMap((level) => level.methods);
    const limit = problem.limits?.maxCollectionElements ?? 10000;
    let status: string;
    if (problem.sql) {
      validateSqlCase(problem.sql, row.case, true);
      const c = object(parseLosslessJson(row.case));
      status = compareSqlResult(
        problem.sql,
        frame.status,
        frame.actual,
        c.expected === undefined ? undefined : stringifyLosslessJson(c.expected),
        frame.sqlTypes ?? [],
      ).status;
    } else {
      if (methods.length)
        validateCodingSequence(
          problem.signature,
          problem.constraints ?? [],
          methods,
          row.case,
          true,
          limit,
        );
      else validateCodingCase(problem.signature, problem.constraints ?? [], row.case, true, limit);
      status = compareCodingCase(
        problem.signature,
        methods,
        row.case,
        frame.status,
        frame.actual,
      ).status;
    }
    return [
      "wrong_answer",
      "syntax_error",
      "runtime_error",
      "time_limit",
      "memory_limit",
      "output_limit",
      "invalid_output",
    ].includes(status)
      ? row.match
      : null;
  } catch {
    return null;
  }
}
async function lockAndLive(tx: Transaction, job: Job): Promise<{ cancelled: boolean } | null> {
  const locked = await tx.execute(
    sql`SELECT j.id FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=${job.jobId}::uuid AND s.id=${job.submissionId}::uuid FOR UPDATE OF j,s`,
  );
  if (!locked.rows.length) return null;
  const row = (
    await tx.execute<{ live: boolean; cancelled: boolean }>(
      sql`SELECT NOT j.finished AND j.attempt_id=${job.attemptId}::uuid AND j.sandbox_scope=${job.sandboxScope} AND j.lease_until>clock_timestamp() AND s.state='running' AS live,s.cancel_requested AS cancelled FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=${job.jobId}::uuid AND s.id=${job.submissionId}::uuid`,
    )
  ).rows[0];
  return row?.live ? { cancelled: row.cancelled } : null;
}
export function postgresCheckpoints(run: Run) {
  return {
    async loadCheckpoint(job: Job): Promise<Checkpoint> {
      return run((scope) =>
        scope.transaction({ ...options, readOnly: true }, async (tx) => {
          const row = (
            await tx.execute<{
              next: number;
              artifact: string | null;
              nanos: string;
              fatal: Uint8Array | null;
            }>(
              sql`SELECT COALESCE(c.next_ordinal,0)::int AS next,c.artifact::text AS artifact,COALESCE(c.compilation_nanos,0)::text AS nanos,c.fatal FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id LEFT JOIN execution_checkpoints c ON c.job_id=j.id WHERE j.id=${job.jobId}::uuid AND j.submission_id=${job.submissionId}::uuid AND j.attempt_id=${job.attemptId}::uuid AND j.sandbox_scope=${job.sandboxScope} AND NOT j.finished AND j.lease_until>clock_timestamp() AND s.state='running' AND NOT s.cancel_requested`,
            )
          ).rows[0];
          if (!row) throw new Error("Checkpoint lease unavailable");
          return {
            nextOrdinal: row.next,
            artifact: row.artifact ?? undefined,
            compilationNanos: BigInt(row.nanos),
            fatal: row.fatal
              ? new TextDecoder("utf-8", { fatal: true }).decode(row.fatal)
              : undefined,
          };
        }),
      );
    },
    async replayCheckpoint(
      job: Job,
      expected: number,
      consume: (ordinal: number, frame: Uint8Array) => Promise<void>,
      signal?: AbortSignal,
    ): Promise<void> {
      if (!Number.isInteger(expected) || expected < 0 || expected > 320)
        throw new Error("Invalid checkpoint prefix");
      for (let next = 0; next < expected;) {
        signal?.throwIfAborted();
        const page = await run((scope) =>
          scope.transaction(
            { ...options, readOnly: true },
            async (tx) =>
              (
                await tx.execute<{ ordinal: number; frame: Uint8Array }>(
                  sql`SELECT cc.ordinal,cc.frame FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id JOIN execution_checkpoints c ON c.job_id=j.id JOIN execution_checkpoint_cases cc ON cc.job_id=j.id WHERE j.id=${job.jobId}::uuid AND j.submission_id=${job.submissionId}::uuid AND j.attempt_id=${job.attemptId}::uuid AND j.sandbox_scope=${job.sandboxScope} AND NOT j.finished AND j.lease_until>clock_timestamp() AND s.state='running' AND NOT s.cancel_requested AND c.next_ordinal=${expected} AND cc.ordinal>=${next} ORDER BY cc.ordinal LIMIT 4`,
                )
              ).rows,
          ),
        );
        if (!page.length) throw new Error("Invalid checkpoint prefix");
        for (const item of page) {
          signal?.throwIfAborted();
          if (item.ordinal !== next || next >= expected)
            throw new Error("Invalid checkpoint prefix");
          await consume(next, await decompressCheckpointFrame(item.frame));
          next++;
        }
      }
    },
    async saveCheckpoint(job: Job, item: CheckpointCase): Promise<void> {
      encodeCheckpointCase(item);
      const compressed = await compressCheckpointFrame(new TextEncoder().encode(item.frame));
      await run((scope) =>
        scope.transaction(options, async (tx) => {
          const match = await matchFailure(tx, job, item);
          if (match)
            await tx.execute(sql`SELECT id FROM matches WHERE id=${match}::uuid FOR UPDATE`);
          const live = await lockAndLive(tx, job);
          if (!live || live.cancelled) throw new Error("Checkpoint lease unavailable");
          await tx.execute(
            sql`INSERT INTO execution_checkpoints(job_id) VALUES(${job.jobId}::uuid) ON CONFLICT DO NOTHING`,
          );
          const row = (
            await tx.execute<{ next: number }>(
              sql`SELECT next_ordinal AS next FROM execution_checkpoints WHERE job_id=${job.jobId}::uuid FOR UPDATE`,
            )
          ).rows[0];
          if (row.next !== item.ordinal) throw new Error("Checkpoint ordinal mismatch");
          if (match) await reconcileMatch(tx, match);
          await tx.execute(
            sql`INSERT INTO execution_checkpoint_cases(job_id,ordinal,frame) VALUES(${job.jobId}::uuid,${item.ordinal},${compressed})`,
          );
          await tx.execute(
            sql`UPDATE execution_checkpoints SET next_ordinal=next_ordinal+1,artifact=COALESCE(${item.artifact ?? null}::jsonb,artifact),compilation_nanos=${item.compilationNanos.toString()}::bigint,fatal=${item.fatal ? new TextEncoder().encode(item.fatal) : null},last_attempt_id=${job.attemptId}::uuid,definite_failures=definite_failures+${match ? 1 : 0} WHERE job_id=${job.jobId}::uuid`,
          );
          await tx.execute(sql`UPDATE execution_jobs SET attempts=1 WHERE id=${job.jobId}::uuid`);
          if (match) await reconcileMatch(tx, match);
        }),
      );
    },
    async yield(job: Job, proof: { attemptId: string; sandboxScope: string }): Promise<void> {
      assertAttemptFence(job, proof);
      await run((scope) =>
        scope.transaction(options, async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(740020)`);
          const live = await lockAndLive(tx, job);
          if (!live) return;
          if (live.cancelled) {
            await tx.execute(
              sql`UPDATE submissions SET state='cancelled',updated_at=clock_timestamp() WHERE id=${job.submissionId}::uuid`,
            );
            await tx.execute(
              sql`UPDATE execution_jobs SET finished=true,attempt_id=NULL,lease_until=NULL WHERE id=${job.jobId}::uuid`,
            );
            return;
          }
          const progressed = (
            await tx.execute<{ ready: boolean }>(
              sql`SELECT EXISTS(SELECT 1 FROM execution_checkpoints WHERE job_id=${job.jobId}::uuid AND last_attempt_id=${job.attemptId}::uuid AND next_ordinal>0) AS ready`,
            )
          ).rows[0].ready;
          if (!progressed) throw new Error("Cannot yield without checkpoint progress");
          await tx.execute(
            sql`UPDATE execution_jobs SET attempt_id=NULL,lease_until=NULL,available_at=clock_timestamp(),attempts=0 WHERE id=${job.jobId}::uuid`,
          );
          await tx.execute(
            sql`UPDATE submissions SET state='queued',updated_at=clock_timestamp() WHERE id=${job.submissionId}::uuid`,
          );
        }),
      );
    },
  };
}
