/** @file complete.ts @description Terminal submission validation and Odyssey progress. @module judging */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import type { Completion } from "@quorem/execution";

export function validateSubmit(c: Completion, count: number) {
  if (
    !c.score ||
    count < 1 ||
    c.score.total !== count ||
    !Number.isInteger(c.score.passed) ||
    c.score.passed < 0 ||
    c.score.passed > count ||
    !c.verdict ||
    (c.verdict === "accepted") !== (c.score.passed === count)
  )
    throw new Error("invalid hidden score");
  if (c.hiddenCases) {
    if (c.hiddenCases.length !== count) throw new Error("incomplete hidden cases");
    let passed = 0;
    for (let i = 0; i < count; i++) {
      const value = c.hiddenCases[i];
      if (value.index !== i || !["accepted", "wrong_answer", "time_limit"].includes(value.status))
        throw new Error("invalid hidden case status");
      if (value.status === "accepted") passed++;
    }
    if (passed !== c.score.passed) throw new Error("inconsistent hidden score");
  }
}
export async function advanceOdyssey(tx: Transaction, id: string) {
  await tx.execute(
    sql`UPDATE odyssey_progress o SET level=LEAST(source.level+1,source.total),completed=source.level+1>source.total FROM (SELECT COALESCE(ie.progress_scope,w.id) AS scope,COALESCE(NULLIF(q.fixture->'problem'->>'id','')::uuid,w.problem_version_id) AS problem,COALESCE(ie.level,s.odyssey_level) AS level,CASE WHEN q.fixture IS NOT NULL THEN COALESCE(NULLIF(jsonb_array_length(q.fixture->'odysseyHiddenCases'),0),jsonb_array_length(q.fixture->'problem'->'odyssey'->'levels')) ELSE jsonb_array_length(v.odyssey->'levels') END AS total FROM submissions s LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN problem_versions v ON v.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id WHERE s.id=${id}::uuid AND s.interview_id IS NULL) source WHERE source.scope IS NOT NULL AND source.level IS NOT NULL AND source.total IS NOT NULL AND o.scope_id=source.scope AND o.problem_version_id=source.problem AND o.level=source.level AND NOT o.completed`,
  );
}
