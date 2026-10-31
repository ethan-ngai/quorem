/** @file identity.ts @description Transaction-local immutable input references. @module judging */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
export interface ManifestCaseIdentity {
  readonly caseCount: number;
  readonly sampleCount: number;
  readonly privateDetails: boolean;
  readonly submitCasesAreSamples: boolean;
  readonly channel: "public" | "private" | "sample";
  readonly hash: string;
  readonly size: number;
}
/** Internal consumers hold their domain locks; the sealed manifest owns count and case identity. */
export async function manifestCaseIdentity(
  tx: Transaction,
  jobId: string,
  ordinal: number,
): Promise<ManifestCaseIdentity> {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 2147483646)
    throw new Error("Invalid input ordinal");
  const row = (
    await tx.execute<{
      cases: number;
      samples: number;
      private_details: boolean;
      fallback: boolean;
      channel: "public" | "private" | "sample";
      hash: string;
      size: number;
    }>(
      sql`SELECT i.case_count AS cases,i.sample_count AS samples,i.private_details,i.submit_cases_are_samples AS fallback,c.channel,encode(b.hash,'hex') AS hash,octet_length(b.data)::int AS size FROM runner_job_inputs i JOIN runner_job_input_cases c ON c.job_id=i.job_id JOIN runner_input_blobs b ON b.hash=c.blob_hash WHERE i.job_id=${jobId}::uuid AND i.sealed AND c.ordinal=${ordinal}`,
    )
  ).rows[0];
  if (!row) throw new Error("Runner input unavailable");
  return {
    caseCount: row.cases,
    sampleCount: row.samples,
    privateDetails: row.private_details,
    submitCasesAreSamples: row.fallback,
    channel: row.channel,
    hash: row.hash,
    size: row.size,
  };
}
/** Read at most 64 KiB without materializing a case in a Worker. */
export async function manifestCasePage(
  tx: Transaction,
  jobId: string,
  ordinal: number,
  offset: number,
): Promise<Uint8Array> {
  if (
    !Number.isInteger(ordinal) ||
    ordinal < 0 ||
    ordinal > 2147483646 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 1073741823
  )
    throw new Error("Invalid input page");
  const row = (
    await tx.execute<{ bytes: Uint8Array }>(
      sql`SELECT substring(b.data FROM ${offset + 1} FOR 65536) AS bytes FROM runner_job_inputs i JOIN runner_job_input_cases c ON c.job_id=i.job_id JOIN runner_input_blobs b ON b.hash=c.blob_hash WHERE i.job_id=${jobId}::uuid AND i.sealed AND c.ordinal=${ordinal} AND ${offset}<=octet_length(b.data)`,
    )
  ).rows[0];
  if (!row) throw new Error("Runner input unavailable");
  return row.bytes;
}
