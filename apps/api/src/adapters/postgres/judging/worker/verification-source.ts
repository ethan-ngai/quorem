/** @file verification-source.ts @description Fenced access to frozen verification data. @module judging */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { decodeJob } from "@quorem/execution";
import { inputBundleInTransaction } from "../inputs/read.ts";
import { retryJudgingLock } from "./frame-lock.ts";
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
    match_id: string | null;
    result_channel: string;
    result_ordinal: number;
  }>(
    sql`SELECT c.job_data,c.sandbox_scope,c.ordinal,encode(c.frame_hash,'hex') AS frame_hash,c.raw_status,c.job_id::text,s.match_id::text,c.result_channel,c.result_ordinal FROM execution_verification_challenges c JOIN execution_jobs j ON j.id=c.job_id JOIN submissions s ON s.id=j.submission_id JOIN execution_completion_staging st ON st.job_id=c.job_id WHERE c.id=${id}::uuid AND c.attempt_id=j.attempt_id AND c.sandbox_scope=j.sandbox_scope AND st.attempt_id=c.attempt_id AND st.sandbox_scope=c.sandbox_scope AND NOT st.eof FOR SHARE OF j,s,st FOR UPDATE OF c`,
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
export async function frozenResultFields(
  tx: Transaction,
  row: { job_id: string; result_channel: string; result_ordinal: number },
  includePages: boolean,
) {
  const fields = await tx.execute<{
    field: string;
    size: number;
    hash: string;
    bytes: Uint8Array | null;
  }>(sql`WITH fields AS (
    SELECT field,string_agg(chunk_data,''::bytea ORDER BY chunk_ordinal) AS data
    FROM execution_completion_field_chunks WHERE job_id=${row.job_id}::uuid
      AND channel=${row.result_channel} AND ordinal=${row.result_ordinal}
      AND field IN ('actual','sqlTypes') GROUP BY field
  )
  SELECT field,octet_length(data)::int AS size,encode(sha256(data),'hex') AS hash,
    CASE WHEN ${includePages} AND octet_length(data)<=65536 THEN data END AS bytes
  FROM fields`);
  const found = new Map(fields.rows.map(({ field, ...value }) => [field, value]));
  const actual = found.get("actual");
  const sqlTypes = found.get("sqlTypes");
  const ref = (value: typeof actual) => (value ? { size: value.size, hash: value.hash } : null);
  const page = (value: typeof actual) =>
    value?.bytes ? { size: value.size, hash: value.hash, bytes: value.bytes, channel: null } : null;
  return {
    actual: ref(actual),
    sqlTypes: ref(sqlTypes),
    pages: {
      actual: page(actual),
      sqlTypes: page(sqlTypes),
    },
  };
}

export function postgresVerificationSource(run: Run) {
  const transact = <T>(fn: (tx: Transaction) => Promise<T>) =>
    retryJudgingLock(() => run((scope) => scope.transaction(opts, fn)));
  const frozenCase = (id: string, includePages: boolean) =>
    transact(async (tx) => {
      const row = await lockVerificationChallenge(tx, id);
      const { actual, sqlTypes, pages } = await frozenResultFields(tx, row, includePages);
      const job = decodeJob(row.job_data, row.sandbox_scope);
      const bundle = includePages
        ? await inputBundleInTransaction(tx, job, row.ordinal, false)
        : undefined;
      return {
        bundle,
        frozen: {
          challenge: id,
          job,
          ordinal: row.ordinal,
          frameHash: row.frame_hash,
          status: row.raw_status,
          actual,
          sqlTypes,
        },
        ...pages,
      };
    });
  return {
    async frozenCase(id: string) {
      return (await frozenCase(id, false)).frozen;
    },
    frozenCaseWithPages(id: string) {
      return frozenCase(id, true);
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
      await transact(async (tx) => {
        const row = await lockVerificationChallenge(tx, id);
        await writeVerificationChunks(tx, id, row, [{ field, ordinal, bytes }]);
      });
    },
  };
}

export async function writeVerificationChunks(
  tx: Transaction,
  id: string,
  row: Awaited<ReturnType<typeof lockVerificationChallenge>>,
  chunks: readonly { field: "actual" | "expected"; ordinal: number; bytes: Uint8Array }[],
) {
  if (!chunks.length || chunks.length > 2) throw new Error("Invalid verification output");
  for (const { field, ordinal, bytes } of chunks)
    if (
      !["actual", "expected"].includes(field) ||
      !Number.isSafeInteger(ordinal) ||
      ordinal < 0 ||
      bytes.length < 1 ||
      bytes.length > 65536
    )
      throw new Error("Invalid verification output");
  const values = sql.join(
    chunks.map(
      ({ field, ordinal, bytes }) => sql`(${field}::text,${ordinal}::int,${bytes}::bytea)`,
    ),
    sql`,`,
  );
  const {
    rows: [result],
  } = await tx.execute<{ matched: number }>(
    sql`WITH incoming(field,ordinal,data) AS (VALUES ${values}),
        inserted AS (
          INSERT INTO execution_verification_output_chunks(challenge_id,field,ordinal,data,hash)
          SELECT ${id}::uuid,i.field,i.ordinal,i.data,sha256(i.data) FROM incoming i
          WHERE NOT EXISTS (
            SELECT 1 FROM execution_completion_frames
            WHERE job_id=${row.job_id}::uuid AND channel=${row.result_channel} AND ordinal=${row.result_ordinal}
          )
          ON CONFLICT DO NOTHING RETURNING 1
        )
        SELECT ((SELECT count(*) FROM inserted) +
          (SELECT count(*) FROM incoming i JOIN execution_verification_output_chunks e
            ON e.challenge_id=${id}::uuid AND e.field=i.field AND e.ordinal=i.ordinal AND e.data=i.data)
        )::int AS matched`,
  );
  if (result.matched !== chunks.length)
    throw new Error("Verification output conflict or sealed frame");
}
