/** @file read.ts @description Lease-fenced, byte-paged immutable runner input reads. @module judging */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import {
  encodeJob,
  type ExecutionInputReader,
  type InputManifest,
  type Job,
} from "@quorem/execution";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const base = sql`FROM runner_job_inputs i JOIN execution_jobs j ON j.id=i.job_id JOIN submissions s ON s.id=j.submission_id LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id`;
function authorized(job: Job) {
  encodeJob(job);
  return sql`i.sealed AND j.id=${job.jobId}::uuid AND s.id=${job.submissionId}::uuid AND j.attempt_id=${job.attemptId}::uuid AND j.sandbox_scope=${job.sandboxScope} AND j.lease_until>clock_timestamp() AND NOT j.finished AND s.state='running' AND NOT s.cancel_requested AND s.id::text=${job.sourceRef} AND COALESCE(q.fixture->'problem'->>'id',w.problem_version_id::text)=${job.problemVersionId} AND COALESCE(q.fixture->'problem'->>'id',w.problem_version_id::text)=${job.suiteRef} AND COALESCE(q.fixture->'problem'->'limits', (SELECT limits FROM problem_versions WHERE id=w.problem_version_id)) @> ${JSON.stringify(job.limits)}::jsonb AND j.language=${job.language} AND j.runtime_revision=${job.runtimeRevision} AND j.harness_revision=${job.harnessRevision} AND i.runtime_revision=${job.runtimeRevision} AND i.harness_revision=${job.harnessRevision}`;
}
type ManifestRow = {
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
};
const manifestFields = sql`s.kind,COALESCE(s.odyssey_level,ie.level)::int AS level,encode((SELECT digest FROM runner_job_input_digests WHERE job_id=i.job_id),'hex') AS suite_hash,i.case_count,i.sample_count,i.private_details,i.submit_cases_are_samples,encode(src.hash,'hex') AS source_hash,octet_length(src.data)::int AS source_size,encode(meta.hash,'hex') AS metadata_hash,octet_length(meta.data)::int AS metadata_size`;
const manifestBlobs = sql`JOIN runner_input_blobs src ON src.hash=i.source_hash JOIN runner_input_blobs meta ON meta.hash=i.metadata_hash`;
const readOptions = { statementTimeoutMs: 5000, lockTimeoutMs: 1000, readOnly: true };
function manifestFrom(row: ManifestRow | undefined): InputManifest {
  if (
    !row ||
    !/^[a-f0-9]{64}$/.test(row.suite_hash) ||
    (row.kind !== "run" && row.kind !== "submit")
  )
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
}

/** Read the checkpoint and its admitted case bound under the same lease predicate. */
export async function inputCheckpoint(run: Run, job: Job) {
  return run((scope) =>
    scope.transaction(readOptions, async (tx) => {
      const {
        rows: [row],
      } = await tx.execute<{
        total: number;
        next: number;
        artifact: string | null;
        nanos: string;
        fatal: Uint8Array | null;
      }>(sql`SELECT (i.case_count+CASE WHEN i.submit_cases_are_samples THEN 0 ELSE i.sample_count END)::int AS total,
        COALESCE(c.next_ordinal,0)::int AS next,c.artifact::text AS artifact,
        COALESCE(c.compilation_nanos,0)::text AS nanos,c.fatal
        ${base} ${manifestBlobs} LEFT JOIN execution_checkpoints c ON c.job_id=i.job_id
        WHERE ${authorized(job)}`);
      if (!row) throw new Error("Checkpoint lease unavailable");
      return {
        total: row.total,
        checkpoint: {
          nextOrdinal: row.next,
          artifact: row.artifact ?? undefined,
          compilationNanos: BigInt(row.nanos),
          fatal: row.fatal
            ? new TextDecoder("utf-8", { fatal: true }).decode(row.fatal)
            : undefined,
        },
      };
    }),
  );
}

/** Read bounded initial pages inside the caller's fenced transaction. */
export async function inputBundleInTransaction(
  tx: Transaction,
  job: Job,
  ordinal: number,
  includeSource: boolean,
  includePages = true,
  sampleOffset = false,
) {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= 2147483647)
    throw new Error("Invalid input ordinal");
  const row = (
    await tx.execute<
      ManifestRow & {
        case_hash: string | null;
        case_size: number;
        channel: "public" | "sample" | "private";
        source_data: Uint8Array | null;
        metadata_data: Uint8Array | null;
        case_data: Uint8Array | null;
      }
    >(sql`SELECT ${manifestFields},
    encode(b.hash,'hex') AS case_hash,octet_length(b.data)::int AS case_size,c.channel,
    CASE WHEN ${includePages} AND ${includeSource} AND octet_length(src.data)<=65536 THEN src.data END AS source_data,
    CASE WHEN ${includePages} AND octet_length(meta.data)<=65536 THEN meta.data END AS metadata_data,
    CASE WHEN ${includePages} AND octet_length(b.data)<=65536 THEN b.data END AS case_data
    ${base} ${manifestBlobs}
    LEFT JOIN runner_job_input_cases c ON c.job_id=i.job_id AND c.ordinal=${ordinal}+CASE WHEN ${sampleOffset} THEN i.case_count ELSE 0 END
    LEFT JOIN runner_input_blobs b ON b.hash=c.blob_hash WHERE ${authorized(job)}`)
  ).rows[0];
  if (!row) throw new Error("Runner input unavailable");
  const manifest = manifestFrom(row);
  const ref = row.case_hash
    ? { hash: row.case_hash, size: row.case_size, channel: row.channel }
    : null;
  return {
    manifest,
    ref,
    source: row.source_data
      ? { ...manifest.source, bytes: row.source_data, channel: null }
      : undefined,
    metadata: row.metadata_data
      ? { ...manifest.metadata, bytes: row.metadata_data, channel: null }
      : undefined,
    testcase: row.case_data && ref ? { ...ref, bytes: row.case_data } : undefined,
  };
}

/** Every page rechecks the live fenced job; no transaction spans response streaming. */
export function postgresInputReader(
  run: Run,
): ExecutionInputReader & Required<Pick<ExecutionInputReader, "inputBundle">> {
  return {
    inputBundle(job, ordinal, includeSource) {
      return run((scope) =>
        scope.transaction(readOptions, (tx) =>
          inputBundleInTransaction(tx, job, ordinal, includeSource),
        ),
      );
    },
    async inputManifest(job) {
      return run((scope) =>
        scope.transaction(readOptions, async (tx) => {
          const row = (
            await tx.execute<ManifestRow>(
              sql`SELECT ${manifestFields} ${base} ${manifestBlobs} WHERE ${authorized(job)}`,
            )
          ).rows[0];
          return manifestFrom(row);
        }),
      );
    },
    async inputCaseRef(job, ordinal) {
      if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= 2147483647)
        throw new Error("Invalid input ordinal");
      return run((scope) =>
        scope.transaction(readOptions, async (tx) => {
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
        }),
      );
    },
    async inputPage(job, kind, ordinal, offset) {
      if (
        !["source", "metadata", "case"].includes(kind) ||
        !Number.isSafeInteger(ordinal) ||
        (kind === "case" ? ordinal < 0 || ordinal >= 2147483647 : ordinal !== 0) ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > 1073741823
      )
        throw new Error("Invalid input page");
      return run((scope) =>
        scope.transaction(readOptions, async (tx) => {
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
        }),
      );
    },
  };
}
