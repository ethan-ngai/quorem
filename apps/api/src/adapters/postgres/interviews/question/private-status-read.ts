/** @file private-status-read.ts @description Epoch-fenced private feedback watermarks. @module interviews */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
export type PrivateStatusPlan = { digest: string };
export type PrivateStatusRef = {
  submission: string;
  ordinal: number;
  version: string;
  size: number;
};
/** Validate every retained submission's normalized coverage and hash only bounded metadata. */
export async function privateStatusPlan(
  tx: Transaction,
  session: string,
  epoch: string,
): Promise<PrivateStatusPlan> {
  const row = (
    await tx.execute<{ digest: string; missing: boolean }>(sql`WITH RECURSIVE selected AS (
    SELECT s.id,s.xmin::text AS submission_version,h.status_count,h.xmin::text AS header_version
    FROM interview_execution_public e JOIN submissions s ON s.id=e.submission_id JOIN execution_jobs j ON j.submission_id=s.id JOIN interviews i ON i.id=e.session_id LEFT JOIN interview_private_status_headers h ON h.submission_id=s.id
    WHERE e.session_id=${session}::uuid AND e.question_epoch=${epoch}::uuid AND j.language=i.language AND s.kind='submit' AND s.state='completed' AND s.result IS NOT NULL
  ), base AS (SELECT s.*,p.ordinal,p.case_id,p.xmin::text AS status_version,p.status_hash FROM selected s LEFT JOIN interview_private_case_statuses p ON p.submission_id=s.id),
  numbered AS (SELECT *,row_number() OVER(ORDER BY id,ordinal NULLS FIRST) n FROM base),
  roll(n,digest) AS (SELECT 0::bigint,sha256(convert_to(json_build_array(${session}::text,${epoch}::text,(SELECT language FROM interviews WHERE id=${session}::uuid))::text,'UTF8')) UNION ALL SELECT r.n+1,sha256(r.digest||sha256(convert_to(json_build_array(b.id::text,b.submission_version,b.header_version,b.status_count,b.ordinal,b.case_id,b.status_version,encode(b.status_hash,'hex'))::text,'UTF8'))) FROM roll r JOIN numbered b ON b.n=r.n+1)
  SELECT encode((SELECT digest FROM roll ORDER BY n DESC LIMIT 1),'hex') AS digest,EXISTS(SELECT 1 FROM selected s WHERE s.header_version IS NULL OR s.status_count<>(SELECT count(*) FROM interview_private_case_statuses p WHERE p.submission_id=s.id)) AS missing`)
  ).rows[0];
  if (row.missing) throw new Error("Interview private statuses require backfill");
  return { digest: row.digest };
}
/** One indexed case's latest normalized status; caller has already authorized its disclosure. */
export async function privateStatusRef(
  tx: Transaction,
  session: string,
  epoch: string,
  caseId: string,
): Promise<PrivateStatusRef | null> {
  return (
    (
      await tx.execute<PrivateStatusRef>(
        sql`SELECT s.id::text AS submission,p.ordinal,p.xmin::text AS version,octet_length(p.status_json)::int AS size FROM interview_execution_public e JOIN submissions s ON s.id=e.submission_id JOIN execution_jobs j ON j.submission_id=s.id JOIN interviews i ON i.id=e.session_id JOIN interview_private_case_statuses p ON p.submission_id=s.id WHERE e.session_id=${session}::uuid AND e.question_epoch=${epoch}::uuid AND j.language=i.language AND s.kind='submit' AND s.state='completed' AND s.result IS NOT NULL AND p.case_id=${caseId} ORDER BY s.admitted_at DESC,s.id DESC LIMIT 1`,
      )
    ).rows[0] ?? null
  );
}
export async function privateStatusPage(
  tx: Transaction,
  row: PrivateStatusRef,
  offset: number,
): Promise<Uint8Array> {
  const data = (
    await tx.execute<{ bytes: Uint8Array }>(
      sql`SELECT substring(status_json FROM ${offset + 1} FOR 65536) AS bytes FROM interview_private_case_statuses WHERE submission_id=${row.submission}::uuid AND ordinal=${row.ordinal} AND xmin::text=${row.version}`,
    )
  ).rows[0];
  if (!data) throw new Error("Interview private status changed");
  return data.bytes;
}
