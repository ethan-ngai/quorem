/** @file verified-progress.ts @description Match progress authority for normalized runner inputs. @module judging */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
export type VerifiedMatchProgress =
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "verified";
      readonly caseCount: number;
      readonly definiteFailures: number;
      readonly terminal: null | { readonly verdict: string; readonly passed: number };
    };
/** Only signed comparison evidence for the current attempt can bound match progress. */
export async function verifiedMatchProgress(
  tx: Transaction,
  jobId: string,
): Promise<VerifiedMatchProgress> {
  const row = (
    await tx.execute<{
      cases: number;
      total: number;
      primary_count: number;
      full_count: number;
      failures: number;
      passed: number;
      unresolved: number;
      first_failure: string | null;
      finished: boolean;
      receipt: boolean;
    }>(sql`
    SELECT i.case_count AS cases,(i.case_count + CASE WHEN i.submit_cases_are_samples THEN 0 ELSE i.sample_count END)::int AS total,
      count(v.ordinal) FILTER (WHERE v.ordinal<i.case_count)::int AS primary_count,
      count(v.ordinal)::int AS full_count,
      count(v.ordinal) FILTER (WHERE v.ordinal<i.case_count AND v.status NOT IN ('accepted','executed'))::int AS failures,
      count(v.ordinal) FILTER (WHERE v.ordinal<i.case_count AND v.status='accepted')::int AS passed,
      count(v.ordinal) FILTER (WHERE v.ordinal<i.case_count AND v.status='executed')::int AS unresolved,
      (SELECT x.status FROM execution_verified_cases x WHERE x.job_id=j.id AND x.attempt_id=j.attempt_id AND x.sandbox_scope=j.sandbox_scope AND x.ordinal<i.case_count AND x.status NOT IN ('accepted','executed') ORDER BY x.ordinal LIMIT 1) AS first_failure,
      j.finished, EXISTS(SELECT 1 FROM execution_completion_receipts r WHERE r.job_id=j.id AND r.attempt_id=j.attempt_id AND r.sandbox_scope=j.sandbox_scope AND r.outcome='completed') AS receipt
    FROM execution_jobs j JOIN runner_job_inputs i ON i.job_id=j.id AND i.sealed
    LEFT JOIN execution_verified_cases v ON v.job_id=j.id AND v.attempt_id=j.attempt_id AND v.sandbox_scope=j.sandbox_scope
    WHERE j.id=${jobId}::uuid GROUP BY i.case_count,i.sample_count,i.submit_cases_are_samples,j.id`)
  ).rows[0];
  if (
    !row ||
    row.cases < 1 ||
    row.primary_count < 1 ||
    row.primary_count > row.cases ||
    row.full_count > row.total ||
    row.failures > row.primary_count ||
    row.passed > row.primary_count
  )
    return { kind: "unavailable" };
  const terminal =
    row.finished &&
    row.receipt &&
    row.full_count === row.total &&
    row.primary_count === row.cases &&
    row.unresolved === 0
      ? { verdict: row.first_failure ?? "accepted", passed: row.passed }
      : null;
  return { kind: "verified", caseCount: row.cases, definiteFailures: row.failures, terminal };
}
