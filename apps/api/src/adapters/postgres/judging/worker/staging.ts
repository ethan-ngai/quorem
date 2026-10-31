/** @file staging.ts @description Attempt-fenced, idempotent completion frame staging. @module judging */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import {
  type CompletionFieldChunk,
  type CompletionHeader,
  type Job,
  assertAttemptFence,
  encodeCompletion,
} from "@quorem/execution";
import { postgresExecutionLoad } from "./load.ts";
import { validateFieldChunks } from "./field-validation.ts";
import { deriveResult } from "./provenance.ts";

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
  if (header.hiddenCases && header.hiddenCases.length > 320)
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
export function postgresCompletionStaging(run: Run) {
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
        ordinal >= 320
      )
        throw new Error("Invalid result frame");
      const spec = await postgresExecutionLoad(run, true)(job);
      const problem = JSON.parse(spec.problemJson) as { limits?: { outputBytes?: number } };
      const outputLimit = problem.limits?.outputBytes;
      if (!Number.isSafeInteger(outputLimit) || outputLimit! < 1)
        throw new Error("Invalid persisted output limit");
      await transact(async (tx) => {
        if (!(await locked(tx, job))) throw new Error("Stale completion");
        const stage = (
          await tx.execute<{ eof: boolean }>(
            sql`SELECT eof FROM execution_completion_staging WHERE job_id=${job.jobId}::uuid AND attempt_id=${job.attemptId}::uuid AND sandbox_scope=${job.sandboxScope} FOR UPDATE`,
          )
        ).rows[0];
        if (!stage || stage.eof) throw new Error("Completion stream closed");
        await validateFieldChunks(tx, job.jobId, channel, ordinal, outputLimit!);
        const selected = await tx.execute<{ field: string; raw: string | null }>(
          sql`WITH grouped AS (SELECT field,string_agg(chunk_data,''::bytea ORDER BY chunk_ordinal) AS data FROM execution_completion_field_chunks WHERE job_id=${job.jobId}::uuid AND channel=${channel} AND ordinal=${ordinal} AND field IN ('actual','sqlTypes') GROUP BY field) SELECT field,CASE WHEN octet_length(data)<=${outputLimit! * 6 + 1024} THEN convert_from(data,'UTF8') ELSE NULL END AS raw FROM grouped`,
        );
        const values = new Map(selected.rows.map((row) => [row.field, row.raw]));
        if (selected.rows.some((row) => row.raw === null))
          throw new Error("Result field exceeds sandbox frame bound");
        const typesRaw = values.get("sqlTypes");
        const types: unknown = typesRaw === undefined ? [] : JSON.parse(typesRaw!);
        if (!Array.isArray(types) || types.some((type) => typeof type !== "string"))
          throw new Error("Invalid SQL types");
        const derived = deriveResult(
          spec,
          channel,
          ordinal,
          status,
          values.get("actual") ?? undefined,
          types as string[],
        );
        const prefix = encoder.encode(
          `{"index":${ordinal},"status":${JSON.stringify(derived.status)}`,
        );
        const suffix = encoder.encode(
          `${derived.actual === undefined ? "" : `,"actual":${derived.actual}`}${derived.expected === undefined ? "" : `,"expected":${derived.expected}`}}`,
        );
        const result = await tx.execute(
          sql`WITH grouped AS (SELECT field,string_agg(chunk_data,''::bytea ORDER BY chunk_ordinal) AS data FROM execution_completion_field_chunks WHERE job_id=${job.jobId}::uuid AND channel=${channel} AND ordinal=${ordinal} AND field IN ('stdout','stderr','diagnostics','sqlTypes') GROUP BY field), assembled AS (SELECT ${prefix}::bytea || COALESCE(string_agg(convert_to(','||to_json(field)::text||':','UTF8')||data,''::bytea ORDER BY field),''::bytea) || ${suffix}::bytea AS data FROM grouped) INSERT INTO execution_completion_frames(job_id,channel,ordinal,status,frame_data,frame_hash) SELECT ${job.jobId}::uuid,${channel},${ordinal},${derived.status},data,sha256(data) FROM assembled ON CONFLICT(job_id,channel,ordinal) DO UPDATE SET frame_data=EXCLUDED.frame_data WHERE execution_completion_frames.status=EXCLUDED.status AND execution_completion_frames.frame_hash=EXCLUDED.frame_hash AND execution_completion_frames.frame_data=EXCLUDED.frame_data RETURNING ordinal`,
        );
        if (!result.rows.length) throw new Error("Completion frame conflict");
      });
    },
    async chunk(job: Job, item: CompletionFieldChunk): Promise<void> {
      if (
        !["public", "sample", "private", "header"].includes(item.channel) ||
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
                  sql`SELECT 1 FROM execution_completion_frames WHERE job_id=${job.jobId}::uuid AND channel=${item.channel} AND ordinal=${item.ordinal}`,
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
      const canonical = JSON.parse(
        encodeCompletion({
          submissionId: header.submissionId,
          attemptId: header.attemptId,
          verdict: header.verdict,
          score: header.score,
          hiddenCases: header.hiddenCases,
          engineFailure: header.engineFailure ? "failed" : undefined,
        }),
      ) as Record<string, unknown>;
      const bytes = encoder.encode(
          JSON.stringify({
            ...canonical,
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
          await tx.execute<{ kind: string; cases: number; interview: boolean; samples: number }>(
            sql`SELECT s.kind,jsonb_array_length(s.cases)::int AS cases,s.interview_id IS NOT NULL AS interview,CASE WHEN COALESCE(q.fixture->'problem'->'odyssey',v.odyssey) IS NULL THEN COALESCE(jsonb_array_length(q.fixture->'problem'->'examples'),(SELECT count(*)::int FROM problem_examples WHERE version_id=v.id)) ELSE COALESCE((SELECT sum(jsonb_array_length(level->'examples')) FROM jsonb_array_elements(COALESCE(q.fixture->'problem'->'odyssey',v.odyssey)->'levels') WITH ORDINALITY st(level,n) WHERE n<=COALESCE(ie.level,s.odyssey_level)),0) END::int AS samples FROM submissions s LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN problem_versions v ON v.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id WHERE s.id=${job.submissionId}::uuid`,
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
              (header.privatePresent && !context.interview) ||
              (header.sampleCount !== 0 && header.sampleCount !== context.samples) ||
              (header.privateCount !== 0 &&
                (!context.interview || header.privateCount !== context.cases))))
        )
          throw new Error("Invalid completion provenance");
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
