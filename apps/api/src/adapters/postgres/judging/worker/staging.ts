/** @file staging.ts @description Attempt-fenced, idempotent completion frame staging. @module judging */
import { sql } from "drizzle-orm";
import {
  classifyDatabaseError,
  type ConnectionScope,
  type Transaction,
} from "@quorem/database/core";
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
import { lockCompletionFrame } from "./frame-lock.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
/** Retry only known PostgreSQL lock rollbacks, under a fresh attempt fence each time. */
async function retryVerificationLock<T>(transaction: () => Promise<T>): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await transaction();
    } catch (error) {
      if (retry === 2 || classifyDatabaseError(error) !== "lock_timeout") throw error;
    }
  }
}
const encoder = new TextEncoder();
async function digest(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data)));
}
function validateChunk(item: CompletionFieldChunk): void {
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
  wakeMatchDeadline?: (match: string) => Promise<void>,
) {
  const transact = <T>(f: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, f));
  const api = {
    async chunk(job: Job, item: CompletionFieldChunk): Promise<void> {
      return api.chunks(job, [item]);
    },
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
      const prepare = postgresVerificationPrepare(run);
      const commit = postgresVerificationCommit(run, verification.verificationPublicKey);
      const challenge = await retryVerificationLock(() => prepare(job, channel, ordinal, status));
      const signed = await verification.verifier.verify(challenge.id);
      const pendingMatch = await retryVerificationLock(() =>
        commit(challenge, signed.receipt, signed.signature, signed.fields),
      );
      if (pendingMatch && wakeMatchDeadline) {
        try {
          await wakeMatchDeadline(pendingMatch);
        } catch {
          /* Scheduled repair can see the committed intent. */
        }
      }
    },
    async chunks(job: Job, items: readonly CompletionFieldChunk[]): Promise<void> {
      if (!items.length || items.length > 16) throw new Error("Invalid completion batch");
      const item = items[0];
      const keys = new Set<string>();
      for (const candidate of items) {
        if (candidate.channel !== item.channel || candidate.ordinal !== item.ordinal)
          throw new Error("Completion batch crosses frames");
        const key = `${candidate.field}:${candidate.chunkOrdinal}`;
        if (keys.has(key)) throw new Error("Duplicate completion chunk");
        keys.add(key);
        validateChunk(candidate);
        if (candidate.channel === "header" && candidate.field !== "diagnostics")
          throw new Error("Invalid header field");
      }
      await transact(async (tx) => {
        await lockCompletionFrame(tx, job, item.channel, item.ordinal);
        const stage = (
          await tx.execute<{ eof: boolean; header: Uint8Array; kind: string; interview: boolean }>(
            sql`SELECT c.eof,c.header_data AS header,s.kind,s.interview_id IS NOT NULL AS interview FROM execution_completion_staging c JOIN execution_jobs j ON j.id=c.job_id JOIN submissions s ON s.id=j.submission_id WHERE c.job_id=${job.jobId}::uuid AND c.attempt_id=${job.attemptId}::uuid AND c.sandbox_scope=${job.sandboxScope}`,
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
        const sealedQuery =
          item.channel === "header"
            ? sql`SELECT 1 FROM execution_completion_header_fields
              WHERE job_id=${job.jobId}::uuid AND field=${item.field}`
            : sql`SELECT 1 FROM execution_completion_frames
              WHERE job_id=${job.jobId}::uuid AND channel=${item.channel} AND ordinal=${item.ordinal}
              UNION ALL SELECT 1 FROM execution_verification_challenges
              WHERE job_id=${job.jobId}::uuid AND result_channel=${item.channel}
                AND result_ordinal=${item.ordinal}`;
        const incoming = sql.join(
          items.map(
            (chunk) => sql`(${chunk.field}::text,${chunk.chunkOrdinal}::int,${chunk.bytes}::bytea)`,
          ),
          sql`, `,
        );
        const {
          rows: [result],
        } = await tx.execute<{ matched: number; sealed: boolean }>(sql`
          WITH incoming(field,chunk_ordinal,data) AS (VALUES ${incoming}),
          seal AS (SELECT EXISTS(${sealedQuery}) AS sealed),
          inserted AS (
            INSERT INTO execution_completion_field_chunks(job_id,channel,ordinal,field,chunk_ordinal,chunk_data,chunk_hash)
            SELECT ${job.jobId}::uuid,${item.channel},${item.ordinal},i.field,i.chunk_ordinal,i.data,sha256(i.data)
            FROM incoming i,seal WHERE NOT seal.sealed ON CONFLICT DO NOTHING RETURNING 1
          ) SELECT seal.sealed,((SELECT count(*) FROM inserted)+(SELECT count(*) FROM incoming i
            JOIN execution_completion_field_chunks c ON c.job_id=${job.jobId}::uuid
              AND c.channel=${item.channel} AND c.ordinal=${item.ordinal} AND c.field=i.field
              AND c.chunk_ordinal=i.chunk_ordinal AND c.chunk_data=i.data AND c.chunk_hash=sha256(i.data)))::int AS matched FROM seal`);
        if (result.matched !== items.length)
          throw new Error(result.sealed ? "Completion frame sealed" : "Completion chunk conflict");
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
      await transact((tx) => sealCompletionStream(tx, job));
    },
  };
  return api;
}

export async function sealCompletionStream(tx: Transaction, job: Job): Promise<void> {
  if (!(await locked(tx, job))) throw new Error("Stale completion");
  await validateCompletionStream(tx, job);
  await tx.execute(
    sql`UPDATE execution_completion_staging SET eof=true WHERE job_id=${job.jobId}::uuid`,
  );
}

/** The caller holds the job and submission locks and has checked the live attempt. */
export async function validateCompletionStream(
  tx: Transaction,
  job: Job,
): Promise<CompletionHeader> {
  const {
    rows: [stage],
  } = await tx.execute<{
    header: Uint8Array;
    unsealed: boolean;
    diagnostics: boolean;
    public_count: number;
    sample_count: number;
    private_count: number;
  }>(sql`SELECT st.header_data AS header,
    EXISTS (
      SELECT 1 FROM execution_completion_field_chunks c WHERE c.job_id=st.job_id
      AND CASE WHEN c.channel='header' THEN NOT EXISTS (
        SELECT 1 FROM execution_completion_header_fields h WHERE h.job_id=c.job_id AND h.field=c.field
      ) ELSE NOT EXISTS (
        SELECT 1 FROM execution_completion_frames f
        WHERE f.job_id=c.job_id AND f.channel=c.channel AND f.ordinal=c.ordinal
      ) END
    ) AS unsealed,
    EXISTS (
      SELECT 1 FROM execution_completion_header_fields h WHERE h.job_id=st.job_id AND h.field='diagnostics'
    ) AS diagnostics,
    frames.*
    FROM execution_completion_staging st
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE channel='public')::int AS public_count,
        count(*) FILTER (WHERE channel='sample')::int AS sample_count,
        count(*) FILTER (WHERE channel='private')::int AS private_count
      FROM execution_completion_frames WHERE job_id=st.job_id
    ) frames
    WHERE st.job_id=${job.jobId}::uuid AND st.attempt_id=${job.attemptId}::uuid
      AND st.sandbox_scope=${job.sandboxScope}
    FOR UPDATE OF st`);
  if (!stage) throw new Error("Missing completion stream");
  if (stage.unsealed) throw new Error("Unsealed completion chunks");
  const header = JSON.parse(new TextDecoder().decode(stage.header)) as CompletionHeader;
  if (stage.diagnostics !== header.diagnosticsPresent) throw new Error("Incomplete diagnostics");
  if (
    stage.public_count !== header.publicCount ||
    stage.sample_count !== header.sampleCount ||
    stage.private_count !== header.privateCount
  )
    throw new Error("Incomplete completion stream");
  return header;
}
