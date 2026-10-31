/** @file verification-prepare.ts @description Freeze raw result chunks before external verification. @module judging */
import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import { encodeJob, type Job } from "@quorem/execution";
import { postgresInputReader } from "../inputs/read.ts";
import { validateFieldChunks } from "./field-validation.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const statuses = new Set([
  "accepted",
  "wrong_answer",
  "executed",
  "syntax_error",
  "runtime_error",
  "time_limit",
  "memory_limit",
  "output_limit",
  "invalid_output",
]);
/** Freeze after validating the current manifest and again under the live attempt lock. */
export function postgresVerificationPrepare(run: Run) {
  const inputs = postgresInputReader(run);
  return async (
    job: Job,
    channel: "public" | "sample" | "private",
    localOrdinal: number,
    status: string,
  ): Promise<string> => {
    if (
      !statuses.has(status) ||
      !Number.isInteger(localOrdinal) ||
      localOrdinal < 0 ||
      localOrdinal > 2147483646
    )
      throw new Error("Invalid verification frame");
    const manifest = await inputs.inputManifest(job);
    const ordinal = channel === "sample" ? manifest.caseCount + localOrdinal : localOrdinal;
    if (
      (channel === "public" && manifest.kind !== "run") ||
      (channel !== "public" && manifest.kind !== "submit") ||
      (channel === "sample"
        ? localOrdinal >= manifest.sampleCount
        : localOrdinal >= manifest.caseCount)
    )
      throw new Error("Invalid verification provenance");
    const ref = await inputs.inputCaseRef(job, ordinal);
    const expectedChannel =
      channel === "private" && manifest.submitCasesAreSamples ? "public" : channel;
    if (ref.channel !== expectedChannel || (channel === "sample" && manifest.submitCasesAreSamples))
      throw new Error("Invalid verification provenance");
    const wire = encodeJob(job);
    return run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
        const locked = await tx.execute(
          sql`SELECT j.id FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id JOIN execution_completion_staging st ON st.job_id=j.id JOIN runner_job_inputs i ON i.job_id=j.id WHERE j.id=${job.jobId}::uuid AND s.id=${job.submissionId}::uuid AND j.attempt_id=${job.attemptId}::uuid AND j.sandbox_scope=${job.sandboxScope} AND st.attempt_id=j.attempt_id AND st.sandbox_scope=j.sandbox_scope AND NOT st.eof AND i.sealed FOR UPDATE OF j,s,st`,
        );
        if (!locked.rows.length) throw new Error("Stale verification");
        const live = (
          await tx.execute<{ live: boolean }>(
            sql`SELECT NOT j.finished AND j.lease_until>clock_timestamp() AND s.state='running' AND NOT s.cancel_requested AS live FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=${job.jobId}::uuid`,
          )
        ).rows[0];
        if (!live?.live) throw new Error("Stale verification");
        const stage = (
          await tx.execute<{ header: Uint8Array }>(
            sql`SELECT header_data AS header FROM execution_completion_staging WHERE job_id=${job.jobId}::uuid`,
          )
        ).rows[0];
        const header: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(stage.header),
        );
        if (!header || typeof header !== "object" || Array.isArray(header))
          throw new Error("Invalid completion header");
        const data = header as Record<string, unknown>;
        const count =
          channel === "public"
            ? data.publicCount
            : channel === "sample"
              ? data.sampleCount
              : data.privateCount;
        const present =
          channel === "public"
            ? data.publicPresent
            : channel === "sample"
              ? data.samplePresent
              : data.privatePresent;
        if (
          present !== true ||
          typeof count !== "number" ||
          !Number.isInteger(count) ||
          localOrdinal >= count
        )
          throw new Error("Invalid completion header");
        const fields = await validateFieldChunks(
          tx,
          job.jobId,
          channel,
          localOrdinal,
          job.limits.outputBytes,
        );
        if (["accepted", "wrong_answer", "executed"].includes(status) && !fields.has("actual"))
          throw new Error("Missing actual result");
        const id = crypto.randomUUID();
        const result = await tx.execute<{ id: string }>(
          sql`WITH frame AS (SELECT sha256(convert_to(${status}||':'||${channel}||':'||${localOrdinal}::text||':'||COALESCE(string_agg(field||':'||chunk_ordinal::text||':'||encode(chunk_hash,'hex')||';','' ORDER BY field,chunk_ordinal),''),'UTF8')) AS digest FROM execution_completion_field_chunks WHERE job_id=${job.jobId}::uuid AND channel=${channel} AND ordinal=${localOrdinal}), inserted AS (INSERT INTO execution_verification_challenges(id,job_id,attempt_id,sandbox_scope,job_data,result_channel,result_ordinal,ordinal,channel,frame_hash,raw_status) SELECT ${id}::uuid,${job.jobId}::uuid,${job.attemptId}::uuid,${job.sandboxScope},${wire},${channel},${localOrdinal},${ordinal},${ref.channel},digest,${status} FROM frame ON CONFLICT(job_id,ordinal) DO UPDATE SET id=execution_verification_challenges.id WHERE execution_verification_challenges.attempt_id=EXCLUDED.attempt_id AND execution_verification_challenges.sandbox_scope=EXCLUDED.sandbox_scope AND execution_verification_challenges.job_data=EXCLUDED.job_data AND execution_verification_challenges.result_channel=EXCLUDED.result_channel AND execution_verification_challenges.result_ordinal=EXCLUDED.result_ordinal AND execution_verification_challenges.channel=EXCLUDED.channel AND execution_verification_challenges.frame_hash=EXCLUDED.frame_hash AND execution_verification_challenges.raw_status=EXCLUDED.raw_status RETURNING id) SELECT id::text FROM inserted`,
        );
        if (!result.rows.length) throw new Error("Verification frame conflict");
        return result.rows[0].id;
      }),
    );
  };
}
