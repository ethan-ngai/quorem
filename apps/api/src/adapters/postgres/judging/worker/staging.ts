/** @file staging.ts @description Attempt-fenced, idempotent completion frame staging. @module judging */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import {
  type CompletionFrame,
  type CompletionFieldChunk,
  type CompletionHeader,
  type Job,
  assertAttemptFence,
  encodeCompletion,
} from "@quorem/execution";
import { parseLosslessJson, stringifyLosslessJson, JsonNumber } from "@quorem/questions";
import { resultCase } from "../results/projection.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const encoder = new TextEncoder();
async function digest(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data)));
}
function counts(header: CompletionHeader): void {
  for (const count of [header.publicCount, header.sampleCount, header.privateCount])
    if (!Number.isInteger(count) || count < 0 || count > 320)
      throw new Error("Invalid result count");
  if (
    typeof header.publicPresent !== "boolean" ||
    typeof header.samplePresent !== "boolean" ||
    typeof header.privatePresent !== "boolean" ||
    (!header.publicPresent && header.publicCount !== 0) ||
    (!header.samplePresent && header.sampleCount !== 0) ||
    (!header.privatePresent && header.privateCount !== 0)
  )
    throw new Error("Invalid result presence");
}
async function locked(tx: Transaction, job: Job): Promise<boolean> {
  const row = await tx.execute(
    sql`SELECT j.id FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=${job.jobId}::uuid AND s.id=${job.submissionId}::uuid FOR UPDATE OF j,s`,
  );
  if (!row.rows.length) return false;
  return !!(
    await tx.execute<{ live: boolean }>(
      sql`SELECT NOT j.finished AND j.attempt_id=${job.attemptId}::uuid AND j.sandbox_scope=${job.sandboxScope} AND j.lease_until>clock_timestamp() AND s.state='running' AS live FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=${job.jobId}::uuid AND s.id=${job.submissionId}::uuid`,
    )
  ).rows[0]?.live;
}
export function postgresCompletionStaging(run: Run) {
  const transact = <T>(f: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, f));
  return {
    async chunk(job: Job, item: CompletionFieldChunk): Promise<void> {
      if (
        !["public", "sample", "private"].includes(item.channel) ||
        !["actual", "expected", "stdout", "stderr", "diagnostics", "sqlTypes"].includes(
          item.field,
        ) ||
        !Number.isInteger(item.ordinal) ||
        item.ordinal < 0 ||
        item.ordinal >= 320 ||
        !Number.isSafeInteger(item.chunkOrdinal) ||
        item.chunkOrdinal < 0 ||
        item.bytes.length < 1 ||
        item.bytes.length > 65536
      )
        throw new Error("Invalid completion chunk");
      const hash = await digest(item.bytes);
      await transact(async (tx) => {
        if (!(await locked(tx, job))) throw new Error("Stale completion");
        const stage = (
          await tx.execute<{ eof: boolean; header: Uint8Array; kind: string; interview: boolean }>(
            sql`SELECT c.eof,c.header_data AS header,s.kind,s.interview_id IS NOT NULL AS interview FROM execution_completion_staging c JOIN execution_jobs j ON j.id=c.job_id JOIN submissions s ON s.id=j.submission_id WHERE c.job_id=${job.jobId}::uuid AND c.attempt_id=${job.attemptId}::uuid AND c.sandbox_scope=${job.sandboxScope} FOR UPDATE OF c`,
          )
        ).rows[0];
        if (!stage || stage.eof) throw new Error("Completion stream closed");
        if (
          (item.channel === "public" && stage.kind !== "run") ||
          (item.channel === "sample" && stage.kind !== "submit") ||
          (item.channel === "private" && (stage.kind !== "submit" || !stage.interview))
        )
          throw new Error("Invalid completion channel");
        const header = JSON.parse(new TextDecoder().decode(stage.header)) as CompletionHeader;
        const count =
          item.channel === "public"
            ? header.publicCount
            : item.channel === "sample"
              ? header.sampleCount
              : header.privateCount;
        if (item.ordinal >= count) throw new Error("Unexpected completion ordinal");
        const inserted = await tx.execute(
          sql`INSERT INTO execution_completion_field_chunks(job_id,channel,ordinal,field,chunk_ordinal,chunk_data,chunk_hash) VALUES(${job.jobId}::uuid,${item.channel},${item.ordinal},${item.field},${item.chunkOrdinal},${item.bytes},${hash}) ON CONFLICT DO NOTHING RETURNING chunk_ordinal`,
        );
        if (!inserted.rows.length) {
          const same = (
            await tx.execute<{ same: boolean }>(
              sql`SELECT chunk_hash=${hash} AND chunk_data=${item.bytes} AS same FROM execution_completion_field_chunks WHERE job_id=${job.jobId}::uuid AND channel=${item.channel} AND ordinal=${item.ordinal} AND field=${item.field} AND chunk_ordinal=${item.chunkOrdinal}`,
            )
          ).rows[0]?.same;
          if (!same) throw new Error("Completion chunk conflict");
        }
      });
    },
    async begin(job: Job, header: CompletionHeader): Promise<void> {
      if (header.submissionId !== job.submissionId || header.attemptId !== job.attemptId)
        throw new Error("Completion fence mismatch");
      counts(header);
      const canonical = JSON.parse(
        encodeCompletion({
          submissionId: header.submissionId,
          attemptId: header.attemptId,
          verdict: header.verdict,
          score: header.score,
          safeDiagnostics: header.safeDiagnostics,
          hiddenCases: header.hiddenCases,
          engineFailure: header.engineFailure,
        }),
      ) as Record<string, unknown>;
      const bytes = encoder.encode(
          JSON.stringify({
            ...canonical,
            publicPresent: header.publicPresent,
            samplePresent: header.samplePresent,
            privatePresent: header.privatePresent,
            publicCount: header.publicCount,
            sampleCount: header.sampleCount,
            privateCount: header.privateCount,
          }),
        ),
        hash = await digest(bytes);
      await transact(async (tx) => {
        if (!(await locked(tx, job))) throw new Error("Stale completion");
        const existing = (
          await tx.execute<{ attempt: string; scope: string; matches: boolean; promoted: boolean }>(
            sql`SELECT attempt_id::text AS attempt,sandbox_scope AS scope,header_hash=${hash} AND header_data=${bytes} AS matches,promoted FROM execution_completion_staging WHERE job_id=${job.jobId}::uuid FOR UPDATE`,
          )
        ).rows[0];
        if (existing && existing.attempt === job.attemptId && existing.scope === job.sandboxScope) {
          if (!existing.matches || existing.promoted) throw new Error("Completion header conflict");
          return;
        }
        if (existing)
          await tx.execute(
            sql`DELETE FROM execution_completion_staging WHERE job_id=${job.jobId}::uuid`,
          );
        await tx.execute(
          sql`INSERT INTO execution_completion_staging(job_id,attempt_id,sandbox_scope,header_data,header_hash) VALUES(${job.jobId}::uuid,${job.attemptId}::uuid,${job.sandboxScope},${bytes},${hash})`,
        );
      });
    },
    async frame(job: Job, frame: CompletionFrame): Promise<void> {
      if (
        !["public", "sample", "private"].includes(frame.channel) ||
        !Number.isInteger(frame.ordinal) ||
        frame.ordinal < 0 ||
        frame.ordinal >= 320
      )
        throw new Error("Invalid result frame");
      const value = resultCase(parseLosslessJson(frame.raw), false);
      if (!(value.index instanceof JsonNumber) || value.index.lexeme !== String(frame.ordinal))
        throw new Error("Result ordinal mismatch");
      const bytes = encoder.encode(stringifyLosslessJson(value)),
        hash = await digest(bytes);
      await transact(async (tx) => {
        if (!(await locked(tx, job))) throw new Error("Stale completion");
        const limits = (
          await tx.execute<{ output: number }>(
            sql`SELECT (COALESCE(q.fixture->'problem'->'limits',p.limits)->>'outputBytes')::int AS output FROM submissions s LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN problem_versions p ON p.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id WHERE s.id=${job.submissionId}::uuid`,
          )
        ).rows[0];
        if (!limits || !Number.isSafeInteger(limits.output) || limits.output < 1)
          throw new Error("Invalid persisted output limit");
        for (const key of ["stdout", "stderr", "actual"] as const) {
          const part = value[key];
          if (part === undefined) continue;
          const raw = key === "actual" ? stringifyLosslessJson(part) : part;
          if (typeof raw !== "string" || encoder.encode(raw).length > limits.output)
            throw new Error("Result output exceeds limit");
        }
        const stage = (
          await tx.execute<{ eof: boolean; header: Uint8Array }>(
            sql`SELECT eof,header_data AS header FROM execution_completion_staging WHERE job_id=${job.jobId}::uuid AND attempt_id=${job.attemptId}::uuid AND sandbox_scope=${job.sandboxScope} FOR UPDATE`,
          )
        ).rows[0];
        if (!stage || stage.eof) throw new Error("Completion stream closed");
        const header = JSON.parse(new TextDecoder().decode(stage.header)) as CompletionHeader;
        const limit =
          frame.channel === "public"
            ? header.publicCount
            : frame.channel === "sample"
              ? header.sampleCount
              : header.privateCount;
        if (frame.ordinal >= limit) throw new Error("Unexpected result frame");
        const inserted = await tx.execute(
          sql`INSERT INTO execution_completion_frames(job_id,channel,ordinal,frame_data,frame_hash) VALUES(${job.jobId}::uuid,${frame.channel},${frame.ordinal},${bytes},${hash}) ON CONFLICT DO NOTHING RETURNING ordinal`,
        );
        if (!inserted.rows.length) {
          const same = (
            await tx.execute<{ same: boolean }>(
              sql`SELECT frame_hash=${hash} AND frame_data=${bytes} AS same FROM execution_completion_frames WHERE job_id=${job.jobId}::uuid AND channel=${frame.channel} AND ordinal=${frame.ordinal}`,
            )
          ).rows[0]?.same;
          if (!same) throw new Error("Result frame conflict");
        }
      });
    },
    async eof(job: Job, proof: { attemptId: string; sandboxScope: string }): Promise<void> {
      assertAttemptFence(job, proof);
      await transact(async (tx) => {
        if (!(await locked(tx, job))) throw new Error("Stale completion");
        const stage = (
          await tx.execute<{ header: Uint8Array }>(
            sql`SELECT header_data AS header FROM execution_completion_staging WHERE job_id=${job.jobId}::uuid AND attempt_id=${job.attemptId}::uuid AND sandbox_scope=${job.sandboxScope} FOR UPDATE`,
          )
        ).rows[0];
        if (!stage) throw new Error("Missing completion stream");
        if (
          (
            await tx.execute(
              sql`SELECT 1 FROM execution_completion_field_chunks WHERE job_id=${job.jobId}::uuid LIMIT 1`,
            )
          ).rows.length
        )
          throw new Error("Unsealed completion chunks");
        const header = JSON.parse(new TextDecoder().decode(stage.header)) as CompletionHeader;
        const rows = await tx.execute<{ channel: string; count: number }>(
          sql`SELECT channel,count(*)::int AS count FROM execution_completion_frames WHERE job_id=${job.jobId}::uuid GROUP BY channel`,
        );
        const byChannel = new Map(rows.rows.map((row) => [row.channel, row.count]));
        if (
          (byChannel.get("public") ?? 0) !== header.publicCount ||
          (byChannel.get("sample") ?? 0) !== header.sampleCount ||
          (byChannel.get("private") ?? 0) !== header.privateCount
        )
          throw new Error("Incomplete completion stream");
        await tx.execute(
          sql`UPDATE execution_completion_staging SET eof=true WHERE job_id=${job.jobId}::uuid`,
        );
      });
    },
  };
}
