/** @file verification-commit.ts @description Commit independently verified result under the original live fence. @module judging */
import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import { verifyResultReceipt, type VerificationReceipt } from "@quorem/execution";
import { lockVerificationChallenge, writeVerificationChunks } from "./verification-source.ts";
import { reconcileMatch } from "../../matches/reconcile/repository.ts";
import type { PreparedVerification } from "./verification-prepare.ts";
import type { VerifiedField } from "./verification-client.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const encode = new TextEncoder();
/** Network and signature verification finish before this function acquires its commit locks. */
export function postgresVerificationCommit(run: Run, publicKey: CryptoKey) {
  return async (
    prepared: PreparedVerification,
    receipt: VerificationReceipt,
    signature: Uint8Array,
    inline?: readonly VerifiedField[],
  ): Promise<void> => {
    if (!(await verifyResultReceipt(receipt, signature, publicKey)))
      throw new Error("Invalid verification signature");
    const { job } = prepared;
    if (
      receipt.challenge !== prepared.id ||
      receipt.jobId !== job.jobId ||
      receipt.submissionId !== job.submissionId ||
      receipt.attemptId !== job.attemptId ||
      receipt.sandboxScope !== job.sandboxScope ||
      receipt.frameHash !== prepared.frameHash ||
      receipt.ordinal !== prepared.ordinal ||
      receipt.channel !== prepared.channel ||
      receipt.binding !== prepared.binding
    )
      throw new Error("Verification provenance mismatch");
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
        const match = (
          await tx.execute<{ id: string | null }>(
            sql`SELECT s.match_id::text AS id FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=${job.jobId}::uuid AND s.id=${job.submissionId}::uuid`,
          )
        ).rows[0]?.id;
        if (match) {
          const locked = await tx.execute(
            sql`SELECT id FROM matches WHERE id=${match}::uuid FOR UPDATE`,
          );
          if (!locked.rows.length) throw new Error("Verification unavailable");
        }
        const row = await lockVerificationChallenge(tx, receipt.challenge);
        if (
          row.job_id !== job.jobId ||
          row.sandbox_scope !== job.sandboxScope ||
          row.ordinal !== receipt.ordinal ||
          row.frame_hash !== receipt.frameHash
        )
          throw new Error("Stale verification");
        if (inline)
          await writeVerificationChunks(
            tx,
            receipt.challenge,
            row,
            inline.map((field) => ({ ...field, ordinal: 0 })),
          );
        const fields = await tx.execute<{
          field: string;
          hash: string;
          n: number;
          first: number;
          last: number;
        }>(
          sql`SELECT field,encode(sha256(string_agg(data,''::bytea ORDER BY ordinal)),'hex') AS hash,count(*)::int AS n,min(ordinal)::int AS first,max(ordinal)::int AS last FROM execution_verification_output_chunks WHERE challenge_id=${receipt.challenge}::uuid GROUP BY field`,
        );
        const found = new Map(fields.rows.map((field) => [field.field, field]));
        for (const [field, expected] of [
          ["actual", receipt.actualHash],
          ["expected", receipt.expectedHash],
        ] as const) {
          const item = found.get(field);
          if (
            (item?.hash ?? null) !== expected ||
            (item && (item.first !== 0 || item.last + 1 !== item.n))
          )
            throw new Error("Verification output mismatch");
        }
        const existing = (
          await tx.execute<{ same: boolean }>(
            sql`SELECT attempt_id=${job.attemptId}::uuid AND sandbox_scope=${job.sandboxScope} AND challenge_id=${receipt.challenge}::uuid AND binding=decode(${receipt.binding},'hex') AND frame_hash=decode(${receipt.frameHash},'hex') AND status=${receipt.status} AND type_mismatch=${receipt.typeMismatch} AND actual_hash IS NOT DISTINCT FROM CASE WHEN ${receipt.actualHash}::text IS NULL THEN NULL ELSE decode(${receipt.actualHash},'hex') END AND expected_hash IS NOT DISTINCT FROM CASE WHEN ${receipt.expectedHash}::text IS NULL THEN NULL ELSE decode(${receipt.expectedHash},'hex') END AS same FROM execution_verified_cases WHERE job_id=${job.jobId}::uuid AND attempt_id=${job.attemptId}::uuid AND ordinal=${receipt.ordinal}`,
          )
        ).rows[0];
        if (existing) {
          if (!existing.same) throw new Error("Verification evidence conflict");
          return;
        }
        const hasStderr =
          job.language === "postgresql" &&
          receipt.status === "invalid_output" &&
          (
            await tx.execute(
              sql`SELECT 1 FROM execution_completion_field_chunks WHERE job_id=${job.jobId}::uuid AND channel=${row.result_channel} AND ordinal=${row.result_ordinal} AND field='stderr' LIMIT 1`,
            )
          ).rows.length > 0;
        const diagnostic = receipt.typeMismatch
          ? "Output column types do not match the SQL schema."
          : job.language === "postgresql" && receipt.status === "invalid_output" && !hasStderr
            ? "The query returned an invalid or unsupported result."
            : null;
        const diagnosticJson = diagnostic === null ? null : JSON.stringify({ message: diagnostic });
        const prefix = encode.encode(
          `{"index":${row.result_ordinal},"status":${JSON.stringify(receipt.status)}`,
        );
        const suffix = encode.encode("}");
        const frame = await tx.execute(
          sql`WITH raw_original AS (SELECT field,string_agg(chunk_data,''::bytea ORDER BY chunk_ordinal) AS data FROM execution_completion_field_chunks WHERE job_id=${job.jobId}::uuid AND channel=${row.result_channel} AND ordinal=${row.result_ordinal} AND field IN ('stdout','stderr','diagnostics','sqlTypes') GROUP BY field), original AS (SELECT field,CASE WHEN field='diagnostics' AND ${diagnosticJson}::text IS NOT NULL THEN convert_to(left(rtrim(convert_from(data,'UTF8'),chr(9)||chr(10)||chr(13)||' '),-1) || CASE WHEN json_array_length(convert_from(data,'UTF8')::json)>0 THEN ',' ELSE '' END || ${diagnosticJson}::text || ']','UTF8') ELSE data END AS data FROM raw_original UNION ALL SELECT 'diagnostics',convert_to('['||${diagnosticJson}::text||']','UTF8') WHERE ${diagnosticJson}::text IS NOT NULL AND NOT EXISTS(SELECT 1 FROM raw_original WHERE field='diagnostics')), verified AS (SELECT field,string_agg(data,''::bytea ORDER BY ordinal) AS data FROM execution_verification_output_chunks WHERE challenge_id=${receipt.challenge}::uuid GROUP BY field), all_fields AS (SELECT * FROM original UNION ALL SELECT * FROM verified), assembled AS (SELECT ${prefix}::bytea || COALESCE(string_agg(convert_to(','||to_json(field)::text||':','UTF8')||data,''::bytea ORDER BY field),''::bytea) || ${suffix}::bytea AS data FROM all_fields), frame AS (INSERT INTO execution_completion_frames(job_id,channel,ordinal,status,frame_data,frame_hash) SELECT ${job.jobId}::uuid,${row.result_channel},${row.result_ordinal},${receipt.status},data,sha256(data) FROM assembled ON CONFLICT DO NOTHING RETURNING job_id)
          INSERT INTO execution_verified_cases(job_id,ordinal,attempt_id,sandbox_scope,challenge_id,binding,frame_hash,actual_hash,expected_hash,type_mismatch,status) SELECT job_id,${receipt.ordinal},${job.attemptId}::uuid,${job.sandboxScope},${receipt.challenge}::uuid,decode(${receipt.binding},'hex'),decode(${receipt.frameHash},'hex'),CASE WHEN ${receipt.actualHash}::text IS NULL THEN NULL ELSE decode(${receipt.actualHash},'hex') END,CASE WHEN ${receipt.expectedHash}::text IS NULL THEN NULL ELSE decode(${receipt.expectedHash},'hex') END,${receipt.typeMismatch},${receipt.status} FROM frame RETURNING ordinal`,
        );
        if (!frame.rows.length) throw new Error("Completion frame conflict");
        if (match) await reconcileMatch(tx, match);
      }),
    );
  };
}
