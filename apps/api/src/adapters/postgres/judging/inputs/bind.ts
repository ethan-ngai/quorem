/** @file bind.ts @description Atomic, sealed input bindings for an admitted job. @module judging */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";

export type FixtureOwner = { version: string } | { session: string; fixture: Uint8Array };
/** A sealed fixture is selected in PostgreSQL, never materialized as a Worker array. */
export function fixtureRows(owner: FixtureOwner, level: number) {
  if (!Number.isSafeInteger(level) || level < 0 || level > 8)
    throw new Error("Invalid fixture stage");
  return "version" in owner
    ? sql`SELECT c.stage,c.ordinal,c.channel,c.blob_hash FROM runner_version_input_cases c JOIN runner_version_inputs i USING(version_id) WHERE i.sealed AND c.version_id=${owner.version}::uuid AND (c.stage=0 OR c.stage BETWEEN 1 AND ${level})`
    : sql`SELECT c.stage,c.ordinal,c.channel,c.blob_hash FROM runner_snapshot_input_cases c JOIN runner_snapshot_inputs i USING(session_id,fixture_id) WHERE i.sealed AND c.session_id=${owner.session}::uuid AND c.fixture_id=${owner.fixture}::bytea AND (c.stage=0 OR c.stage BETWEEN 1 AND ${level})`;
}
/** Store one already validated custom-case JSON value without changing its lexical bytes. */
export async function storeCustomInput(tx: Transaction, raw: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(raw);
  const row = (
    await tx.execute<{ hash: Uint8Array }>(
      sql`WITH input AS (SELECT ${bytes}::bytea AS data), inserted AS (INSERT INTO runner_input_blobs(hash,data) SELECT sha256(data),data FROM input ON CONFLICT(hash) DO NOTHING RETURNING hash) SELECT hash FROM inserted UNION ALL SELECT b.hash FROM runner_input_blobs b,input i WHERE b.hash=sha256(i.data) AND b.data=i.data LIMIT 1`,
    )
  ).rows[0];
  if (!row) throw new Error("Runner input hash collision");
  return row.hash;
}
/** Call after job and, for interviews, interview_execution are inserted, inside admission's transaction. */
export async function bindJobInputs(
  tx: Transaction,
  input: {
    jobId: string;
    owner: FixtureOwner;
    level: number;
    primary: "example" | "hidden" | "custom";
    custom: readonly Uint8Array[];
    caseCount: number;
    sampleCount: number;
    privateDetails: boolean;
    submitCasesAreSamples: boolean;
  },
): Promise<void> {
  if (
    !Number.isSafeInteger(input.caseCount) ||
    !Number.isSafeInteger(input.sampleCount) ||
    input.caseCount < 0 ||
    input.sampleCount < 0 ||
    input.caseCount + (input.submitCasesAreSamples ? 0 : input.sampleCount) > 2147483647
  )
    throw new Error("Invalid job input count");
  const source = (
    await tx.execute<{ hash: Uint8Array }>(
      sql`WITH input AS (SELECT convert_to(s.source,'UTF8') AS data FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=${input.jobId}::uuid), inserted AS (INSERT INTO runner_input_blobs(hash,data) SELECT sha256(data),data FROM input ON CONFLICT(hash) DO NOTHING RETURNING hash) SELECT hash FROM inserted UNION ALL SELECT b.hash FROM runner_input_blobs b,input i WHERE b.hash=sha256(i.data) AND b.data=i.data LIMIT 1`,
    )
  ).rows[0];
  if (!source) throw new Error("Runner source unavailable");
  const metadata =
    "version" in input.owner
      ? (
          await tx.execute<{ hash: Uint8Array }>(
            sql`SELECT metadata_hash AS hash FROM runner_version_inputs WHERE version_id=${input.owner.version}::uuid AND sealed`,
          )
        ).rows[0]
      : (
          await tx.execute<{ hash: Uint8Array }>(
            sql`SELECT metadata_hash AS hash FROM runner_snapshot_inputs WHERE session_id=${input.owner.session}::uuid AND fixture_id=${input.owner.fixture}::bytea AND sealed`,
          )
        ).rows[0];
  if (!metadata) throw new Error("Runner fixture unavailable");
  const version = "version" in input.owner ? input.owner.version : null;
  const session = "session" in input.owner ? input.owner.session : null;
  const fixture = "fixture" in input.owner ? input.owner.fixture : null;
  await tx.execute(
    sql`INSERT INTO runner_job_inputs(job_id,version_id,session_id,fixture_id,metadata_hash,source_hash,runtime_revision,harness_revision,case_count,sample_count,private_details,submit_cases_are_samples) SELECT j.id,${version}::uuid,${session}::uuid,${fixture}::bytea,${metadata.hash},${source.hash},j.runtime_revision,j.harness_revision,${input.caseCount},${input.sampleCount},${input.privateDetails},${input.submitCasesAreSamples} FROM execution_jobs j WHERE j.id=${input.jobId}::uuid`,
  );
  const primary =
    input.primary === "custom"
      ? input.custom.length
        ? sql`SELECT 0 AS stage, v.ordinal, 'public'::text AS channel, v.hash AS blob_hash FROM (VALUES ${sql.join(
            input.custom.map((hash, ordinal) => sql`(${ordinal}::integer,${hash}::bytea)`),
            sql`,`,
          )}) AS v(ordinal,hash)`
        : sql`SELECT 0 AS stage,0 AS ordinal,'public'::text AS channel,NULL::bytea AS blob_hash WHERE false`
      : sql`SELECT stage,ordinal,${input.primary === "hidden" ? "private" : "public"}::text AS channel,blob_hash FROM (${fixtureRows(input.owner, input.level)}) f WHERE channel=${input.primary}`;
  const samples =
    input.sampleCount && !input.submitCasesAreSamples
      ? sql`SELECT stage,ordinal,'sample'::text AS channel,blob_hash FROM (${fixtureRows(input.owner, input.level)}) f WHERE channel='example'`
      : sql`SELECT 0 AS stage,0 AS ordinal,'sample'::text AS channel,NULL::bytea AS blob_hash WHERE false`;
  await tx.execute(sql`INSERT INTO runner_job_input_cases(job_id,ordinal,channel,blob_hash)
    SELECT ${input.jobId}::uuid,(row_number() OVER (ORDER BY bucket,stage,ordinal)-1)::integer,channel,blob_hash
    FROM (SELECT 0 AS bucket,* FROM (${primary}) p UNION ALL SELECT 1 AS bucket,* FROM (${samples}) s) selected`);
  const sealed = await tx.execute(
    sql`UPDATE runner_job_inputs SET sealed=true WHERE job_id=${input.jobId}::uuid RETURNING job_id`,
  );
  if (!sealed.rows.length) throw new Error("Runner job unavailable");
}
