/** @file read.ts @description Lease-fenced, byte-paged immutable runner input reads. @module judging */
import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import { encodeJob, type ExecutionInputReader, type Job } from "@quorem/execution";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const base = sql`FROM runner_job_inputs i JOIN execution_jobs j ON j.id=i.job_id JOIN submissions s ON s.id=j.submission_id LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id`;
function authorized(job: Job) {
  encodeJob(job);
  return sql`i.sealed AND j.id=${job.jobId}::uuid AND s.id=${job.submissionId}::uuid AND j.attempt_id=${job.attemptId}::uuid AND j.sandbox_scope=${job.sandboxScope} AND j.lease_until>clock_timestamp() AND NOT j.finished AND s.state='running' AND NOT s.cancel_requested AND s.id::text=${job.sourceRef} AND COALESCE(q.fixture->'problem'->>'id',w.problem_version_id::text)=${job.problemVersionId} AND COALESCE(q.fixture->'problem'->>'id',w.problem_version_id::text)=${job.suiteRef} AND COALESCE(q.fixture->'problem'->'limits', (SELECT limits FROM problem_versions WHERE id=w.problem_version_id)) @> ${JSON.stringify(job.limits)}::jsonb AND j.language=${job.language} AND j.runtime_revision=${job.runtimeRevision} AND j.harness_revision=${job.harnessRevision} AND i.runtime_revision=${job.runtimeRevision} AND i.harness_revision=${job.harnessRevision}`;
}
/** Every page rechecks the live fenced job; no transaction spans response streaming. */
export function postgresInputReader(run: Run): ExecutionInputReader {
  return {
    async inputManifest(job) {
      return run((scope) =>
        scope.transaction(
          { statementTimeoutMs: 5000, lockTimeoutMs: 1000, readOnly: true },
          async (tx) => {
            const row = (
              await tx.execute<{
                kind: "run" | "submit";
                level: number | null;
                case_count: number;
                sample_count: number;
                private_details: boolean;
                submit_cases_are_samples: boolean;
                suite_hash: string;
                source_hash: string;
                source_size: number;
                metadata_hash: string;
                metadata_size: number;
              }>(
                sql`SELECT s.kind,COALESCE(s.odyssey_level,ie.level)::int AS level,encode(sha256(convert_to(COALESCE((SELECT string_agg(c.channel||':'||encode(c.blob_hash,'hex')||';','' ORDER BY c.ordinal) FROM runner_job_input_cases c WHERE c.job_id=i.job_id),''),'UTF8')),'hex') AS suite_hash,i.case_count,i.sample_count,i.private_details,i.submit_cases_are_samples,encode(src.hash,'hex') AS source_hash,octet_length(src.data)::int AS source_size,encode(meta.hash,'hex') AS metadata_hash,octet_length(meta.data)::int AS metadata_size ${base} JOIN runner_input_blobs src ON src.hash=i.source_hash JOIN runner_input_blobs meta ON meta.hash=i.metadata_hash WHERE ${authorized(job)}`,
              )
            ).rows[0];
            if (!row || (row.kind !== "run" && row.kind !== "submit"))
              throw new Error("Runner input unavailable");
            return {
              kind: row.kind,
              level: row.level,
              caseCount: row.case_count,
              sampleCount: row.sample_count,
              privateDetails: row.private_details,
              submitCasesAreSamples: row.submit_cases_are_samples,
              suiteHash: row.suite_hash,
              source: { hash: row.source_hash, size: row.source_size },
              metadata: { hash: row.metadata_hash, size: row.metadata_size },
            };
          },
        ),
      );
    },
    async inputCaseRef(job, ordinal) {
      if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 319)
        throw new Error("Invalid input ordinal");
      return run((scope) =>
        scope.transaction(
          { statementTimeoutMs: 5000, lockTimeoutMs: 1000, readOnly: true },
          async (tx) => {
            const row = (
              await tx.execute<{
                hash: string;
                size: number;
                channel: "public" | "private" | "sample";
              }>(
                sql`SELECT encode(b.hash,'hex') AS hash,octet_length(b.data)::int AS size,c.channel ${base} JOIN runner_job_input_cases c ON c.job_id=i.job_id AND c.ordinal=${ordinal} JOIN runner_input_blobs b ON b.hash=c.blob_hash WHERE ${authorized(job)}`,
              )
            ).rows[0];
            if (!row) throw new Error("Runner input unavailable");
            return row;
          },
        ),
      );
    },
    async inputPage(job, kind, ordinal, offset) {
      if (
        !["source", "metadata", "case"].includes(kind) ||
        !Number.isSafeInteger(ordinal) ||
        (kind === "case" ? ordinal < 0 || ordinal > 319 : ordinal !== 0) ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > 1073741823
      )
        throw new Error("Invalid input page");
      return run((scope) =>
        scope.transaction(
          { statementTimeoutMs: 5000, lockTimeoutMs: 1000, readOnly: true },
          async (tx) => {
            const hash =
              kind === "source"
                ? sql`i.source_hash`
                : kind === "metadata"
                  ? sql`i.metadata_hash`
                  : sql`c.blob_hash`;
            const join =
              kind === "case"
                ? sql`JOIN runner_job_input_cases c ON c.job_id=i.job_id AND c.ordinal=${ordinal}`
                : sql``;
            const channel = kind === "case" ? sql`c.channel` : sql`NULL::text`;
            const row = (
              await tx.execute<{
                bytes: Uint8Array;
                size: number;
                hash: string;
                channel: "public" | "sample" | "private" | null;
              }>(
                sql`SELECT substring(b.data FROM ${offset + 1} FOR 65536) AS bytes,octet_length(b.data)::int AS size,encode(b.hash,'hex') AS hash,${channel} AS channel ${base} ${join} JOIN runner_input_blobs b ON b.hash=${hash} WHERE ${authorized(job)}`,
              )
            ).rows[0];
            if (!row || offset > row.size) throw new Error("Runner input unavailable");
            return row;
          },
        ),
      );
    },
  };
}
