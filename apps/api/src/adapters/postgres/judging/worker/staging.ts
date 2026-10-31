/** @file staging.ts @description Attempt-fenced, idempotent completion frame staging. @module judging */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import {
  type CompletionFieldChunk,
  type CompletionHeader,
  type Job,
  assertAttemptFence,
} from "@quorem/execution";
import { validateFieldChunks } from "./field-validation.ts";
import type { ResultVerifier } from "./verification-client.ts";
import { postgresVerificationPrepare } from "./verification-prepare.ts";
import { postgresVerificationCommit } from "./verification-commit.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const encoder = new TextEncoder();
async function digest(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data)));
}
function counts(header: CompletionHeader): void {
  for (const count of [header.publicCount, header.sampleCount, header.privateCount])
    if (!Number.isInteger(count) || count < 0 || count > 2147483647)
      throw new Error("Invalid result count");
  if (
    typeof header.engineFailure !== "boolean" ||
    typeof header.diagnosticsPresent !== "boolean" ||
    typeof header.publicPresent !== "boolean" ||
    typeof header.samplePresent !== "boolean" ||
    typeof header.privatePresent !== "boolean" ||
    (!header.publicPresent && header.publicCount !== 0) ||
    (!header.samplePresent && header.sampleCount !== 0) ||
    (!header.privatePresent && header.privateCount !== 0)
  )
    throw new Error("Invalid result presence");
  if (header.hiddenCases && header.hiddenCases.length > 2147483647)
    throw new Error("Invalid hidden case count");
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
export function postgresCompletionStaging(
  run: Run,
  verification?: { verifier: ResultVerifier; verificationPublicKey: CryptoKey },
) {
  const transact = <T>(f: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, f));
  return {
    async sealDiagnostics(job: Job): Promise<void> {
      await transact(async (tx) => {
        if (!(await locked(tx, job))) throw new Error("Stale completion");
        const stage = (
          await tx.execute<{ eof: boolean; header: Uint8Array }>(
            sql`SELECT eof,header_data AS header FROM execution_completion_staging WHERE job_id=${job.jobId}::uuid AND attempt_id=${job.attemptId}::uuid AND sandbox_scope=${job.sandboxScope} FOR UPDATE`,
          )
        ).rows[0];
        if (!stage || stage.eof) throw new Error("Completion stream closed");
        const header = JSON.parse(new TextDecoder().decode(stage.header)) as CompletionHeader;
        if (!header.diagnosticsPresent) throw new Error("Unexpected diagnostics");
        const fields = await validateFieldChunks(tx, job.jobId, "header", 0, 1);
        if (fields.size !== 1 || !fields.has("diagnostics")) throw new Error("Missing diagnostics");
        const result = await tx.execute(
          sql`WITH source AS (SELECT string_agg(chunk_data,''::bytea ORDER BY chunk_ordinal) AS data FROM execution_completion_field_chunks WHERE job_id=${job.jobId}::uuid AND channel='header' AND ordinal=0 AND field='diagnostics') INSERT INTO execution_completion_header_fields(job_id,field,field_data,field_hash) SELECT ${job.jobId}::uuid,'diagnostics',data,sha256(data) FROM source WHERE data IS NOT NULL ON CONFLICT(job_id,field) DO UPDATE SET field_data=EXCLUDED.field_data WHERE execution_completion_header_fields.field_hash=EXCLUDED.field_hash AND execution_completion_header_fields.field_data=EXCLUDED.field_data RETURNING field`,
        );
        if (!result.rows.length) throw new Error("Diagnostics conflict");
      });
    },
    async seal(
      job: Job,
      channel: "public" | "sample" | "private",
      ordinal: number,
      status: string,
    ): Promise<void> {
      if (
        !["public", "sample", "private"].includes(channel) ||
        !Number.isInteger(ordinal) ||
        ordinal < 0 ||
        ordinal > 2147483646
      )
        throw new Error("Invalid result frame");
      if (!verification) throw new Error("Result verifier unavailable");
      const challenge = await postgresVerificationPrepare(run)(job, channel, ordinal, status);
      const signed = await verification.verifier.verify(challenge);
      if (signed.receipt.challenge !== challenge)
        throw new Error("Verification challenge mismatch");
      await postgresVerificationCommit(run, verification.verificationPublicKey)(
        signed.receipt,
        signed.signature,
      );
    },
    async chunk(job: Job, item: CompletionFieldChunk): Promise<void> {
      if (
        !["public", "sample", "private", "header"].includes(item.channel) ||
        !["actual", "stdout", "stderr", "diagnostics", "sqlTypes"].includes(item.field) ||
        !Number.isInteger(item.ordinal) ||
        item.ordinal < 0 ||
        item.ordinal > 2147483646 ||
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
          (item.channel === "private" && stage.kind !== "submit")
        )
          throw new Error("Invalid completion channel");
        const header = JSON.parse(new TextDecoder().decode(stage.header)) as CompletionHeader;
        if (
          item.channel === "header" &&
          (item.ordinal !== 0 || item.field !== "diagnostics" || !header.diagnosticsPresent)
        )
          throw new Error("Invalid header field");
        const count =
          item.channel === "public"
            ? header.publicCount
            : item.channel === "sample"
              ? header.sampleCount
              : item.channel === "private"
                ? header.privateCount
                : 1;
        if (item.ordinal >= count) throw new Error("Unexpected completion ordinal");
        const sealed =
          item.channel === "header"
            ? (
                await tx.execute(
                  sql`SELECT 1 FROM execution_completion_header_fields WHERE job_id=${job.jobId}::uuid AND field=${item.field}`,
                )
              ).rows.length > 0
            : (
                await tx.execute(
                  sql`SELECT 1 FROM execution_completion_frames WHERE job_id=${job.jobId}::uuid AND channel=${item.channel} AND ordinal=${item.ordinal} UNION ALL SELECT 1 FROM execution_verification_challenges WHERE job_id=${job.jobId}::uuid AND result_channel=${item.channel} AND result_ordinal=${item.ordinal}`,
                )
              ).rows.length > 0;
        if (sealed) {
          const same = (
            await tx.execute<{ same: boolean }>(
              sql`SELECT chunk_hash=${hash} AND chunk_data=${item.bytes} AS same FROM execution_completion_field_chunks WHERE job_id=${job.jobId}::uuid AND channel=${item.channel} AND ordinal=${item.ordinal} AND field=${item.field} AND chunk_ordinal=${item.chunkOrdinal}`,
            )
          ).rows[0]?.same;
          if (!same) throw new Error("Completion frame sealed");
          return;
        }
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
      const bytes = encoder.encode(
          JSON.stringify({
            submissionId: header.submissionId,
            attemptId: header.attemptId,
            engineFailure: header.engineFailure,
            diagnosticsPresent: header.diagnosticsPresent,
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
        const context = (
          await tx.execute<{ kind: string; cases: number; samples: number; fallback: boolean }>(
            sql`SELECT s.kind,i.case_count AS cases,i.sample_count AS samples,i.submit_cases_are_samples AS fallback FROM submissions s JOIN execution_jobs j ON j.submission_id=s.id JOIN runner_job_inputs i ON i.job_id=j.id AND i.sealed WHERE s.id=${job.submissionId}::uuid AND j.id=${job.jobId}::uuid`,
          )
        ).rows[0];
        if (
          !context ||
          (context.kind === "run" &&
            (header.samplePresent ||
              header.privatePresent ||
              (header.publicCount !== 0 && header.publicCount !== context.cases))) ||
          (context.kind === "submit" &&
            (header.publicPresent ||
              (header.sampleCount !== 0 &&
                (context.fallback || header.sampleCount !== context.samples)) ||
              (header.privateCount !== 0 && header.privateCount !== context.cases)))
        )
          throw new Error("Invalid completion provenance");
        const existing = (
          await tx.execute<{ attempt: string; scope: string; matches: boolean }>(
            sql`SELECT attempt_id::text AS attempt,sandbox_scope AS scope,header_hash=${hash} AND header_data=${bytes} AS matches FROM execution_completion_staging WHERE job_id=${job.jobId}::uuid FOR UPDATE`,
          )
        ).rows[0];
        if (existing && existing.attempt === job.attemptId && existing.scope === job.sandboxScope) {
          if (!existing.matches) throw new Error("Completion header conflict");
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
              sql`SELECT 1 FROM execution_completion_field_chunks c WHERE c.job_id=${job.jobId}::uuid AND CASE WHEN c.channel='header' THEN NOT EXISTS(SELECT 1 FROM execution_completion_header_fields h WHERE h.job_id=c.job_id AND h.field=c.field) ELSE NOT EXISTS(SELECT 1 FROM execution_completion_frames f WHERE f.job_id=c.job_id AND f.channel=c.channel AND f.ordinal=c.ordinal) END LIMIT 1`,
            )
          ).rows.length
        )
          throw new Error("Unsealed completion chunks");
        const header = JSON.parse(new TextDecoder().decode(stage.header)) as CompletionHeader;
        const hasDiagnostics =
          (
            await tx.execute(
              sql`SELECT 1 FROM execution_completion_header_fields WHERE job_id=${job.jobId}::uuid AND field='diagnostics'`,
            )
          ).rows.length !== 0;
        if (hasDiagnostics !== header.diagnosticsPresent) throw new Error("Incomplete diagnostics");
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
