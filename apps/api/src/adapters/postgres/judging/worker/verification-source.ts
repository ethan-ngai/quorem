/** @file verification-source.ts @description Fenced access to frozen verification data. @module judging */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { decodeJob } from "@quorem/execution";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const opts = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
/** Each page and write rechecks the live attempt and wall clock after acquiring its locks. */
export async function lockVerificationChallenge(tx: Transaction, id: string) {
  const rows = await tx.execute<{
    job_data: string;
    sandbox_scope: string;
    ordinal: number;
    frame_hash: string;
    raw_status: string;
    job_id: string;
    result_channel: string;
    result_ordinal: number;
  }>(
    sql`SELECT c.job_data,c.sandbox_scope,c.ordinal,encode(c.frame_hash,'hex') AS frame_hash,c.raw_status,c.job_id::text,c.result_channel,c.result_ordinal FROM execution_verification_challenges c JOIN execution_jobs j ON j.id=c.job_id JOIN submissions s ON s.id=j.submission_id JOIN execution_completion_staging st ON st.job_id=c.job_id WHERE c.id=${id}::uuid AND c.attempt_id=j.attempt_id AND c.sandbox_scope=j.sandbox_scope AND st.attempt_id=c.attempt_id AND st.sandbox_scope=c.sandbox_scope AND NOT st.eof FOR UPDATE OF j,s,st,c`,
  );
  const row = rows.rows[0];
  if (!row) throw new Error("Verification unavailable");
  const live = (
    await tx.execute<{ live: boolean }>(
      sql`SELECT NOT j.finished AND j.lease_until>clock_timestamp() AND s.state='running' AND NOT s.cancel_requested AS live FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=${row.job_id}::uuid`,
    )
  ).rows[0];
  if (!live?.live) throw new Error("Verification unavailable");
  return row;
}
export function postgresVerificationSource(run: Run) {
  const transact = <T>(fn: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction(opts, fn));
  return {
    async frozenCase(id: string) {
      return transact(async (tx) => {
        const row = await lockVerificationChallenge(tx, id);
        const fields = await tx.execute<{ field: string; size: number; hash: string }>(
          sql`SELECT field,octet_length(string_agg(chunk_data,''::bytea ORDER BY chunk_ordinal))::int AS size,encode(sha256(string_agg(chunk_data,''::bytea ORDER BY chunk_ordinal)),'hex') AS hash FROM execution_completion_field_chunks WHERE job_id=${row.job_id}::uuid AND channel=${row.result_channel} AND ordinal=${row.result_ordinal} AND field IN ('actual','sqlTypes') GROUP BY field`,
        );
        const found = new Map(fields.rows.map((f) => [f.field, { size: f.size, hash: f.hash }]));
        return {
          challenge: id,
          job: decodeJob(row.job_data, row.sandbox_scope),
          ordinal: row.ordinal,
          frameHash: row.frame_hash,
          status: row.raw_status,
          actual: found.get("actual") ?? null,
          sqlTypes: found.get("sqlTypes") ?? null,
        };
      });
    },
    async fieldPage(id: string, field: "actual" | "sqlTypes", offset: number) {
      if (
        !["actual", "sqlTypes"].includes(field) ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > 1073741823
      )
        throw new Error("Invalid verification page");
      return transact(async (tx) => {
        const row = await lockVerificationChallenge(tx, id);
        const result = (
          await tx.execute<{ bytes: Uint8Array; size: number; hash: string }>(
            sql`WITH source AS (SELECT string_agg(chunk_data,''::bytea ORDER BY chunk_ordinal) AS data FROM execution_completion_field_chunks WHERE job_id=${row.job_id}::uuid AND channel=${row.result_channel} AND ordinal=${row.result_ordinal} AND field=${field}) SELECT substring(data FROM ${offset + 1} FOR 65536) AS bytes,octet_length(data)::int AS size,encode(sha256(data),'hex') AS hash FROM source WHERE data IS NOT NULL AND ${offset}<=octet_length(data)`,
          )
        ).rows[0];
        if (!result) throw new Error("Verification unavailable");
        return { ...result, channel: null };
      });
    },
    async putChunk(id: string, field: "actual" | "expected", ordinal: number, bytes: Uint8Array) {
      if (
        !["actual", "expected"].includes(field) ||
        !Number.isSafeInteger(ordinal) ||
        ordinal < 0 ||
        bytes.length < 1 ||
        bytes.length > 65536
      )
        throw new Error("Invalid verification output");
      await transact(async (tx) => {
        const row = await lockVerificationChallenge(tx, id);
        const previous = (
          await tx.execute<{ same: boolean }>(
            sql`SELECT data=${bytes}::bytea AS same FROM execution_verification_output_chunks WHERE challenge_id=${id}::uuid AND field=${field} AND ordinal=${ordinal}`,
          )
        ).rows[0];
        if (previous) {
          if (!previous.same) throw new Error("Verification output conflict");
          return;
        }
        const sealed =
          (
            await tx.execute(
              sql`SELECT 1 FROM execution_completion_frames WHERE job_id=${row.job_id}::uuid AND channel=${row.result_channel} AND ordinal=${row.result_ordinal}`,
            )
          ).rows.length > 0;
        if (sealed) throw new Error("Verification frame sealed");
        await tx.execute(
          sql`INSERT INTO execution_verification_output_chunks(challenge_id,field,ordinal,data,hash) VALUES(${id}::uuid,${field},${ordinal},${bytes}::bytea,sha256(${bytes}::bytea))`,
        );
      });
    },
  };
}
