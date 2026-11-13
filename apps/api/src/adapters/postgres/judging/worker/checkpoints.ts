import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import {
  CASE_LANES,
  compressCheckpointFrame,
  decompressCheckpointFrame,
  decodeManifestCheckpointFrame,
  assertManifestCheckpoint,
  decodeJudgeFrame,
  encodeJudgeFrame,
  validateCompiledArtifact,
  encodeCheckpointCase,
  assertAttemptFence,
  type Checkpoint,
  type CheckpointCase,
  type Job,
  type ExecutionRepository,
} from "@quorem/execution";
import { inputBundleInTransaction, inputCheckpoint, postgresInputReader } from "../inputs/read.ts";

import { retryJudgingLock } from "./frame-lock.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
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
  const retryLocked: Run = (operation) => retryJudgingLock(() => run(operation));
  async function releaseAttempt(
    job: Job,
    proof: { attemptId: string; sandboxScope: string },
    cancellationOnly: boolean,
  ) {
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
        if (cancellationOnly) return;
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
  }

  const api: Pick<
    ExecutionRepository,
    "loadCheckpoint" | "replayCheckpoint" | "saveCheckpoint" | "yield" | "acknowledgeCancellation"
  > &
    Required<Pick<ExecutionRepository, "saveCheckpointBatch">> = {
    async loadCheckpoint(job: Job): Promise<Checkpoint> {
      const { total, checkpoint } = await inputCheckpoint(run, job);
      if (checkpoint.nextOrdinal > total) throw new Error("Invalid checkpoint prefix");
      if (checkpoint.nextOrdinal > 0)
        await api.replayCheckpoint(job, checkpoint.nextOrdinal, async () => {});
      else if (checkpoint.artifact || checkpoint.fatal || checkpoint.compilationNanos !== 0n)
        throw new Error("Unbound checkpoint metadata");
      return checkpoint;
    },
    async replayCheckpoint(
      job: Job,
      expected: number,
      consume: (ordinal: number, frame: Uint8Array) => Promise<void>,
      signal?: AbortSignal,
    ): Promise<void> {
      if (!Number.isInteger(expected) || expected < 0 || expected > 2147483647)
        throw new Error("Invalid checkpoint prefix");
      const reader = postgresInputReader(run),
        manifest = await reader.inputManifest(job);
      const total =
        manifest.caseCount + (manifest.submitCasesAreSamples ? 0 : manifest.sampleCount);
      if (expected > total) throw new Error("Invalid checkpoint prefix");
      for (let next = 0; next < expected;) {
        signal?.throwIfAborted();
        const page = await run((scope) =>
          scope.transaction(
            { ...options, readOnly: true },
            async (tx) =>
              (
                await tx.execute<{
                  ordinal: number;
                  frame: Uint8Array;
                  artifact: string | null;
                  fatal: Uint8Array | null;
                  nanos: string;
                }>(
                  sql`SELECT cc.ordinal,cc.frame,c.artifact::text AS artifact,c.fatal,c.compilation_nanos::text AS nanos FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id JOIN execution_checkpoints c ON c.job_id=j.id JOIN execution_checkpoint_cases cc ON cc.job_id=j.id WHERE j.id=${job.jobId}::uuid AND j.submission_id=${job.submissionId}::uuid AND j.attempt_id=${job.attemptId}::uuid AND j.sandbox_scope=${job.sandboxScope} AND NOT j.finished AND j.lease_until>clock_timestamp() AND s.state='running' AND NOT s.cancel_requested AND c.next_ordinal=${expected} AND cc.ordinal>=${next} ORDER BY cc.ordinal LIMIT 4`,
                )
              ).rows,
          ),
        );
        if (!page.length) throw new Error("Invalid checkpoint prefix");
        for (const item of page) {
          signal?.throwIfAborted();
          if (item.ordinal !== next || next >= expected)
            throw new Error("Invalid checkpoint prefix");
          const raw = await decompressCheckpointFrame(item.frame),
            envelope = decodeManifestCheckpointFrame(
              new TextDecoder("utf-8", { fatal: true }).decode(raw),
            );
          const ref = await reader.inputCaseRef(job, next);
          await assertManifestCheckpoint(
            job,
            manifest,
            ref,
            next,
            envelope.provenance,
            false,
            envelope.frame,
            next === expected - 1
              ? {
                  artifact: item.artifact ?? undefined,
                  fatal: item.fatal
                    ? new TextDecoder("utf-8", { fatal: true }).decode(item.fatal)
                    : undefined,
                  compilationNanos: BigInt(item.nanos),
                }
              : undefined,
          );
          await consume(next, raw);
          next++;
        }
      }
    },
    async saveCheckpoint(job: Job, item: CheckpointCase): Promise<void> {
      await api.saveCheckpointBatch(job, [item]);
    },
    async saveCheckpointBatch(job: Job, items: readonly CheckpointCase[]): Promise<void> {
      if (!items.length || items.length > CASE_LANES) throw new Error("Invalid checkpoint batch");
      const frames = await Promise.all(
        items.map(async (item) => {
          encodeCheckpointCase(item);
          const envelope = decodeManifestCheckpointFrame(item.frame);
          if (envelope.frame.artifact !== undefined) throw new Error("Invalid checkpoint frame");
          const compressed = await compressCheckpointFrame(new TextEncoder().encode(item.frame));
          return { item, envelope, compressed };
        }),
      );
      await retryLocked((scope) =>
        scope.transaction(options, async (tx) => {
          const live = await lockAndLive(tx, job);
          if (!live || live.cancelled) throw new Error("Checkpoint lease unavailable");
          await tx.execute(
            sql`INSERT INTO execution_checkpoints(job_id) VALUES(${job.jobId}::uuid) ON CONFLICT DO NOTHING`,
          );
          const row = (
            await tx.execute<{
              next: number;
              artifact: string | null;
              fatal: Uint8Array | null;
              nanos: string;
            }>(
              sql`SELECT next_ordinal AS next,artifact::text AS artifact,fatal,compilation_nanos::text AS nanos FROM execution_checkpoints WHERE job_id=${job.jobId}::uuid FOR UPDATE`,
            )
          ).rows[0];
          // Advance the prefix in memory and write it once after every frame is verified.
          for (const { item, envelope } of frames) {
            const bundle = await inputBundleInTransaction(tx, job, item.ordinal, false, false);
            const { manifest, ref } = bundle;
            if (!ref) throw new Error("Checkpoint input unavailable");
            if (row.next !== item.ordinal) throw new Error("Checkpoint ordinal mismatch");
            if (item.compilationNanos < BigInt(row.nanos))
              throw new Error("Checkpoint compilation time regressed");
            if (item.artifact) {
              validateCompiledArtifact(item.artifact, job.language);
              if (
                row.artifact &&
                !(
                  await tx.execute<{ same: boolean }>(
                    sql`SELECT ${row.artifact}::jsonb = ${item.artifact}::jsonb AS same`,
                  )
                ).rows[0].same
              )
                throw new Error("Checkpoint artifact conflict");
            }
            const previousFatal = row.fatal
              ? decodeJudgeFrame(new TextDecoder("utf-8", { fatal: true }).decode(row.fatal))
              : undefined;
            const nextFatal = item.fatal ? decodeJudgeFrame(item.fatal) : undefined;
            if (
              nextFatal &&
              (nextFatal.status !== "syntax_error" ||
                nextFatal.artifact !== undefined ||
                job.language === "postgresql" ||
                envelope.frame.status !== "syntax_error")
            )
              throw new Error("Invalid checkpoint fatal");
            if (
              previousFatal &&
              (!nextFatal || encodeJudgeFrame(previousFatal) !== encodeJudgeFrame(nextFatal))
            )
              throw new Error("Checkpoint fatal conflict");
            await assertManifestCheckpoint(
              job,
              manifest,
              ref,
              item.ordinal,
              envelope.provenance,
              true,
              envelope.frame,
              {
                artifact: item.artifact ?? row.artifact ?? undefined,
                fatal: item.fatal,
                compilationNanos: item.compilationNanos,
              },
            );
            row.next++;
            row.artifact = item.artifact ?? row.artifact;
            row.nanos = item.compilationNanos.toString();
            row.fatal = item.fatal ? new TextEncoder().encode(item.fatal) : null;
          }
          const values = sql.join(
            frames.map(
              ({ item, compressed }) => sql`(${job.jobId}::uuid,${item.ordinal},${compressed})`,
            ),
            sql`, `,
          );
          await tx.execute(
            sql`INSERT INTO execution_checkpoint_cases(job_id,ordinal,frame) VALUES ${values}`,
          );
          await tx.execute(
            sql`UPDATE execution_checkpoints SET next_ordinal=${row.next},artifact=${row.artifact}::jsonb,compilation_nanos=${row.nanos}::bigint,fatal=${row.fatal},last_attempt_id=${job.attemptId}::uuid WHERE job_id=${job.jobId}::uuid`,
          );
          await tx.execute(sql`UPDATE execution_jobs SET attempts=1 WHERE id=${job.jobId}::uuid`);
        }),
      );
    },
    yield: (job, proof) => releaseAttempt(job, proof, false),
    acknowledgeCancellation: (job, proof) => releaseAttempt(job, proof, true),
  };
  return api;
}
