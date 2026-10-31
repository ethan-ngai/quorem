/** @file bind.ts @description Atomic, sealed input bindings for an admitted job. @module judging */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";

export type FixtureOwner = { version: string } | { session: string; fixture: Uint8Array };
export interface FixtureCaseRef {
  stage: number;
  ordinal: number;
  hash: Uint8Array;
}
export interface SelectedInputRef {
  channel: "public" | "private" | "sample";
  hash: Uint8Array;
}
/** Returns fixed-size references, never case contents. The admission owner selects and validates context. */
export async function fixtureCaseRefs(
  tx: Transaction,
  owner: FixtureOwner,
  channel: "example" | "hidden",
  level: number,
): Promise<FixtureCaseRef[]> {
  if (!Number.isSafeInteger(level) || level < 0) throw new Error("Invalid fixture stage");
  const rows =
    "version" in owner
      ? await tx.execute<{ stage: number; ordinal: number; hash: Uint8Array }>(
          sql`SELECT c.stage,c.ordinal,c.blob_hash AS hash FROM runner_version_input_cases c JOIN runner_version_inputs i ON i.version_id=c.version_id WHERE i.sealed AND c.version_id=${owner.version}::uuid AND c.channel=${channel} AND (c.stage=0 OR c.stage BETWEEN 1 AND ${level}) ORDER BY c.stage,c.ordinal`,
        )
      : await tx.execute<{ stage: number; ordinal: number; hash: Uint8Array }>(
          sql`SELECT c.stage,c.ordinal,c.blob_hash AS hash FROM runner_snapshot_input_cases c JOIN runner_snapshot_inputs i USING(session_id,fixture_id) WHERE i.sealed AND c.session_id=${owner.session}::uuid AND c.fixture_id=${owner.fixture}::bytea AND c.channel=${channel} AND (c.stage=0 OR c.stage BETWEEN 1 AND ${level}) ORDER BY c.stage,c.ordinal`,
        );
  if (rows.rows.length > 320) throw new Error("Runner fixture exceeds admitted case count");
  return rows.rows;
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
    cases: readonly SelectedInputRef[];
    caseCount: number;
    sampleCount: number;
    privateDetails: boolean;
    submitCasesAreSamples: boolean;
  },
): Promise<void> {
  if (
    input.cases.length > 320 ||
    !Number.isInteger(input.caseCount) ||
    !Number.isInteger(input.sampleCount) ||
    input.caseCount < 0 ||
    input.sampleCount < 0 ||
    input.cases.length !== input.caseCount + (input.submitCasesAreSamples ? 0 : input.sampleCount)
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
  if (input.cases.length) {
    const values = sql.join(
      input.cases.map(
        (item, ordinal) =>
          sql`(${input.jobId}::uuid,${ordinal}::integer,${item.channel}::text,${item.hash}::bytea)`,
      ),
      sql`, `,
    );
    await tx.execute(
      sql`INSERT INTO runner_job_input_cases(job_id,ordinal,channel,blob_hash) VALUES ${values}`,
    );
  }
  const sealed = await tx.execute(
    sql`UPDATE runner_job_inputs SET sealed=true WHERE job_id=${input.jobId}::uuid RETURNING job_id`,
  );
  if (!sealed.rows.length) throw new Error("Runner job unavailable");
}
