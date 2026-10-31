/** @file private-cases.ts @description Member-scoped private case projections. @module interviews */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { parseLosslessJson, type JsonValue } from "@quorem/questions";
import type { Principal } from "../../../../modules/identity/model.ts";
import type { InterviewRole } from "../../../../modules/interviews/lifecycle/model.ts";
type Obj = { [key: string]: JsonValue };
/** Candidate SQL joins visibility before fetching any case bytes. */
export async function privateCaseProjection(
  tx: Transaction,
  actor: Principal,
  id: string,
  epoch: string,
  role: InterviewRole,
): Promise<{ details: JsonValue[]; revealed: JsonValue[] }> {
  const metadata = (
    await tx.execute<{ expected: string[]; ids: string[] }>(
      sql`SELECT q.private_ids AS expected,ARRAY(SELECT c.case_id FROM interview_question_private_cases c WHERE c.session_id=q.session_id AND c.question_epoch=q.question_epoch ORDER BY c.ordinal) AS ids FROM interview_question_public q JOIN interviews i ON i.id=q.session_id AND i.question_epoch=q.question_epoch WHERE q.session_id=${id}::uuid AND q.question_epoch=${epoch}::uuid`,
    )
  ).rows[0];
  if (
    !metadata ||
    metadata.ids.length !== metadata.expected.length ||
    metadata.ids.some((value, index) => value !== metadata.expected[index])
  )
    throw new Error("Interview private cases require backfill");
  const statuses = (
    await tx.execute<{ idx: number; status: string }>(
      sql`SELECT DISTINCT ON ((c->>'index')::int) (c->>'index')::int AS idx,c->>'status' AS status FROM interview_execution_public e JOIN submissions s ON s.id=e.submission_id JOIN execution_jobs j ON j.submission_id=s.id JOIN interviews i ON i.id=e.session_id CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.private_statuses)='array' AND jsonb_array_length(e.private_statuses)>0 THEN e.private_statuses WHEN jsonb_typeof(s.result->'hiddenCases')='array' THEN s.result->'hiddenCases' ELSE '[]'::jsonb END) c WHERE e.session_id=${id}::uuid AND e.question_epoch=${epoch}::uuid AND j.language=i.language AND s.kind='submit' AND s.state='completed' AND c->>'status' IS NOT NULL ORDER BY (c->>'index')::int,s.admitted_at DESC,s.id DESC`,
    )
  ).rows;
  const byIndex = new Map(statuses.map((s) => [s.idx, s.status]));
  const columns = sql`c.case_id AS id,c.ordinal,c.case_data AS data,(v.case_id IS NOT NULL) AS revealed`;
  const selected =
    role === "interviewer"
      ? await tx.execute<{ id: string; ordinal: number; data: Uint8Array; revealed: boolean }>(
          sql`SELECT ${columns} FROM interview_question_private_cases c JOIN interviews i ON i.id=c.session_id AND i.question_epoch=c.question_epoch JOIN interview_members m ON m.session_id=i.id AND m.user_id=${actor.userId} AND m.removed_at IS NULL AND m.role='interviewer' LEFT JOIN interview_case_visibility v ON v.session_id=c.session_id AND v.question_epoch=c.question_epoch AND v.case_id=c.case_id WHERE c.session_id=${id}::uuid AND c.question_epoch=${epoch}::uuid ORDER BY c.ordinal`,
        )
      : await tx.execute<{ id: string; ordinal: number; data: Uint8Array; revealed: boolean }>(
          sql`SELECT ${columns} FROM interview_question_private_cases c JOIN interviews i ON i.id=c.session_id AND i.question_epoch=c.question_epoch JOIN interview_members m ON m.session_id=i.id AND m.user_id=${actor.userId} AND m.removed_at IS NULL JOIN interview_case_visibility v ON v.session_id=c.session_id AND v.question_epoch=c.question_epoch AND v.case_id=c.case_id WHERE c.session_id=${id}::uuid AND c.question_epoch=${epoch}::uuid ORDER BY c.ordinal`,
        );
  const details: JsonValue[] = [],
    revealed: JsonValue[] = [];
  for (const row of selected.rows) {
    const value: Obj = {
      id: row.id,
      case: parseLosslessJson(new TextDecoder("utf-8", { fatal: true }).decode(row.data)),
      revealed: row.revealed,
    };
    const status = byIndex.get(row.ordinal);
    if (status) value.status = status;
    if (role === "interviewer") details.push(value);
    if (row.revealed) revealed.push(value);
  }
  return { details, revealed };
}
