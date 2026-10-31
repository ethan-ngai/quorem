/** @file evaluated-status.ts @description Bounded authoritative public case status history. @module judging */
import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
export type EvaluatedStatusScope =
  | { kind: "workspace"; workspaceId: string; owner: string }
  | { kind: "interview"; sessionId: string; epoch: string };
export interface EvaluatedStatusPlan {
  readonly count: number;
  readonly digest: string;
}
export type EvaluatedStatusRow = {
  readonly index: number;
  readonly submission: string;
  readonly channel: string;
  readonly ordinal: number;
  readonly version: string;
  readonly size: number;
};
function selection(scope: EvaluatedStatusScope): SQL {
  return scope.kind === "workspace"
    ? sql`SELECT s.id,s.admitted_at,s.kind,s.xmin::text AS submission_version FROM submissions s JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN odyssey_progress o ON o.scope_id=w.id AND o.problem_version_id=w.problem_version_id WHERE s.workspace_id=${scope.workspaceId}::uuid AND s.owner_id=${scope.owner} AND s.state='completed' AND s.result IS NOT NULL AND NOT s.custom_run AND s.odyssey_level IS NOT NULL AND s.admitted_at>=COALESCE(o.reset_at,'-infinity'::timestamptz)`
    : sql`SELECT s.id,s.admitted_at,s.kind,s.xmin::text AS submission_version FROM interview_execution_public e JOIN submissions s ON s.id=e.submission_id JOIN execution_jobs j ON j.submission_id=s.id JOIN interviews i ON i.id=e.session_id WHERE e.session_id=${scope.sessionId}::uuid AND e.question_epoch=${scope.epoch}::uuid AND j.language=i.language AND s.state='completed' AND s.result IS NOT NULL AND NOT s.custom_run`;
}
function seed(scope: EvaluatedStatusScope): SQL {
  return scope.kind === "workspace"
    ? sql`json_build_array('workspace',${scope.workspaceId}::text,${scope.owner}::text,(SELECT o.reset_at::text FROM odyssey_progress o JOIN workspaces w ON w.id=o.scope_id AND w.problem_version_id=o.problem_version_id WHERE w.id=${scope.workspaceId}::uuid))::text`
    : sql`json_build_array('interview',${scope.sessionId}::text,${scope.epoch}::text,(SELECT language FROM interviews WHERE id=${scope.sessionId}::uuid))::text`;
}
/** Constant-size rolling digest detects retention, backfill, history and reset changes. */
export async function evaluatedStatusPlan(
  tx: Transaction,
  scope: EvaluatedStatusScope,
): Promise<EvaluatedStatusPlan> {
  const selected = selection(scope);
  const row = (
    await tx.execute<{ count: number; digest: string; missing: boolean }>(sql`
 WITH RECURSIVE selected AS (${selected}), base AS (
  SELECT s.id,s.submission_version,s.kind,h.xmin::text AS header_version,c.channel,c.ordinal,c.xmin::text AS case_version,st.case_index,st.xmin::text AS status_version,st.status_hash AS status_hash
  FROM selected s LEFT JOIN submission_result_headers h ON h.submission_id=s.id LEFT JOIN submission_public_result_cases c ON c.submission_id=s.id LEFT JOIN submission_public_case_statuses st ON st.submission_id=c.submission_id AND st.channel=c.channel AND st.ordinal=c.ordinal
 ), numbered AS (
  SELECT *,row_number() OVER(ORDER BY id,channel NULLS FIRST,ordinal NULLS FIRST) AS n FROM base
 ), roll(n,digest) AS (
  SELECT 0::bigint,sha256(convert_to(${seed(scope)},'UTF8')) UNION ALL
  SELECT r.n+1,sha256(r.digest || sha256(convert_to(json_build_array(b.id::text,b.submission_version,b.kind,b.header_version,b.channel,b.ordinal,b.case_version,b.case_index,b.status_version,encode(b.status_hash,'hex'))::text,'UTF8'))) FROM roll r JOIN numbered b ON b.n=r.n+1
 ) SELECT (SELECT count(DISTINCT case_index)::int FROM base WHERE case_index IS NOT NULL) AS count,
   encode((SELECT digest FROM roll ORDER BY n DESC LIMIT 1),'hex') AS digest,
   EXISTS(SELECT 1 FROM base WHERE header_version IS NULL OR (ordinal IS NOT NULL AND (status_version IS NULL OR channel<>CASE WHEN kind='run' THEN 'public' ELSE 'sample' END))) AS missing`)
  ).rows[0];
  if (row.missing) throw new Error("Public case statuses require backfill");
  return { count: row.count, digest: row.digest };
}
/** One latest row at a time; caller rechecks the plan and authorization in this transaction. */
export async function nextEvaluatedStatus(
  tx: Transaction,
  scope: EvaluatedStatusScope,
  after: number,
): Promise<EvaluatedStatusRow | null> {
  if (!Number.isSafeInteger(after) || after < -1 || after > 2147483646)
    throw new RangeError("Invalid status cursor");
  const selected = selection(scope);
  return (
    (
      await tx.execute<EvaluatedStatusRow>(
        sql`WITH selected AS (${selected}), latest AS (SELECT DISTINCT ON(st.case_index) st.case_index AS index,st.submission_id::text AS submission,st.channel,st.ordinal,st.xmin::text AS version,octet_length(st.status_json)::int AS size FROM selected s JOIN submission_public_result_cases c ON c.submission_id=s.id AND c.channel=CASE WHEN s.kind='run' THEN 'public' ELSE 'sample' END JOIN submission_public_case_statuses st ON st.submission_id=c.submission_id AND st.channel=c.channel AND st.ordinal=c.ordinal WHERE st.case_index>${after} ORDER BY st.case_index,s.admitted_at DESC,s.id DESC) SELECT * FROM latest ORDER BY index LIMIT 1`,
      )
    ).rows[0] ?? null
  );
}
/** One bounded page, fenced by the status row's original xmin. */
export async function evaluatedStatusPage(
  tx: Transaction,
  row: EvaluatedStatusRow,
  offset: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1073741823)
    throw new RangeError("Invalid status page");
  const result = (
    await tx.execute<{ bytes: Uint8Array }>(
      sql`SELECT substring(status_json FROM ${offset + 1} FOR 65536) AS bytes FROM submission_public_case_statuses WHERE submission_id=${row.submission}::uuid AND channel=${row.channel} AND ordinal=${row.ordinal} AND case_index=${row.index} AND xmin::text=${row.version} AND ${offset}<=octet_length(status_json)`,
    )
  ).rows[0];
  if (!result) throw new Error("Public case status changed");
  return result.bytes;
}
