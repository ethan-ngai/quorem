/** @file snapshot.ts @description Authorized interview snapshot public projection. @module interviews */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
import type { Principal } from "../../../../modules/identity/model.ts";
import { capabilitiesInTransaction } from "../../access/repository.ts";
import { jsonObject, restorePublicExamples } from "../../problems/queries/public-projection.ts";
import { lockInterview } from "../lifecycle/access.ts";
type Obj = { [key: string]: JsonValue };
/** Candidate reads never fetch the private question or its lossless fixture sidecar. */
export async function prepareInterviewSnapshot(
  tx: Transaction,
  actor: Principal,
  id: string,
): Promise<{
  json: string;
  epoch: string;
  version: string;
  role: string;
  markers: Record<
    string,
    | { kind: "examples"; level: number; rowVersion: string }
    | {
        kind: "cases";
        revealedOnly: boolean;
        cases: {
          id: string;
          ordinal: number;
          rowVersion: string;
          revealed: boolean;
          status?: string;
        }[];
      }
  >;
}> {
  const access = await lockInterview(tx, actor, id, capabilitiesInTransaction);
  const row = (
    await tx.execute<{
      metadata: string;
      total: number;
      level: number;
      completed: boolean;
      members: string;
      invite: string | null;
      interviewer: string | null;
      latest: string | null;
    }>(sql`SELECT
 jsonb_strip_nulls(jsonb_build_object('id',i.id,'title',i.title,'state',i.state,'hostId',i.host_id,'role',m.role,'questionEpoch',i.question_epoch,'version',i.version,'admissionLocked',i.admission_locked,'monitoring',i.monitoring,'hints',q.metadata->'hints','document',jsonb_build_object('source',i.source,'version',i.document_version,'epoch',i.document_epoch),
 'question',jsonb_build_object('language',i.language,'problem',jsonb_strip_nulls(jsonb_build_object('id',q.metadata->'problem'->'id','slug',q.metadata->'problem'->'slug','version',q.metadata->'problem'->'version','title',q.metadata->'problem'->'title','difficulty',q.metadata->'problem'->'difficulty','tags',q.metadata->'problem'->'tags','companies',q.metadata->'problem'->'companies','leetcodeId',q.metadata->'problem'->'leetcodeId','statementMarkdown',q.metadata->'problem'->'statementMarkdown','signature',q.metadata->'problem'->'signature','constraints',q.metadata->'problem'->'constraints','limits',q.metadata->'problem'->'limits','sql',q.metadata->'problem'->'sql','starterSource',q.metadata->'problem'->'starterSource','runtimeRevision',q.metadata->'problem'->'runtimeRevision','languages',q.metadata->'problem'->'languages','odyssey',CASE WHEN jsonb_typeof(q.metadata->'problem'->'odyssey'->'levels')='array' THEN jsonb_build_object('levels',(SELECT COALESCE(jsonb_agg(jsonb_build_object('title',v->'title','statementMarkdown',v->'statementMarkdown','methods',v->'methods') ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(q.metadata->'problem'->'odyssey'->'levels') WITH ORDINALITY l(v,n) WHERE n<=COALESCE(p.level,1))) ELSE NULL END)))))::text AS metadata,
 CASE WHEN jsonb_typeof(q.metadata->'problem'->'odyssey'->'levels')='array' THEN jsonb_array_length(q.metadata->'problem'->'odyssey'->'levels') ELSE 0 END AS total,COALESCE(p.level,1) AS level,COALESCE(p.completed,false) AS completed,
 (SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('userId',im.user_id,'name',u.display_name,'role',im.role,'guest',u.kind='guest','image',NULLIF(u.profile_image,''),'color',NULLIF(u.profile_color,0))) ORDER BY im.role,im.user_id),'[]'::jsonb)::text FROM interview_members im JOIN users u ON u.id=im.user_id WHERE im.session_id=i.id AND im.removed_at IS NULL) AS members,
 CASE WHEN m.role='interviewer' THEN i.invite_token ELSE NULL END AS invite,CASE WHEN m.role='interviewer' THEN i.interviewer_invite_token ELSE NULL END AS interviewer,
 (SELECT e.submission_id::text FROM interview_execution_public e JOIN submissions s ON s.id=e.submission_id JOIN execution_jobs j ON j.submission_id=s.id AND j.language=i.language WHERE e.session_id=i.id AND e.question_epoch=i.question_epoch ORDER BY s.admitted_at DESC LIMIT 1) AS latest
 FROM interviews i JOIN interview_question_public q ON q.session_id=i.id AND q.question_epoch=i.question_epoch JOIN interview_members m ON m.session_id=i.id AND m.user_id=${actor.userId} AND m.removed_at IS NULL LEFT JOIN odyssey_progress p ON p.scope_id=i.question_epoch AND p.problem_version_id=NULLIF(q.metadata->'problem'->>'id','')::uuid WHERE i.id=${id}::uuid AND i.deleted_at IS NULL`)
  ).rows[0];
  if (!row) throw new Error("Interview unavailable");
  const level = row.total ? row.level : 0;
  if (row.total > 0 && (level < 1 || level > row.total))
    throw new Error("Invalid interview progress");
  const nonce = crypto.randomUUID();
  const markers: Record<
    string,
    | { kind: "examples"; level: number; rowVersion: string }
    | {
        kind: "cases";
        revealedOnly: boolean;
        cases: {
          id: string;
          ordinal: number;
          rowVersion: string;
          revealed: boolean;
          status?: string;
        }[];
      }
  > = {};
  const exampleRows = (
    await tx.execute<{ level: number; rowVersion: string }>(
      sql`SELECT level,xmin::text AS "rowVersion" FROM interview_public_examples WHERE session_id=${id}::uuid AND question_epoch=${access.questionEpoch}::uuid ORDER BY level`,
    )
  ).rows;
  if (exampleRows.length !== row.total + 1 || exampleRows.some((v, i) => v.level !== i))
    throw new Error("Interview public examples require backfill");
  const examples = exampleRows.slice(0, level + 1).map((entry) => {
    const key = `__quorem_stream_${nonce}_example_${entry.level}__`;
    markers[key] = { kind: "examples", level: entry.level, rowVersion: entry.rowVersion };
    return key;
  });
  const value = jsonObject(parseLosslessJson(row.metadata)),
    question = jsonObject(value.question),
    problem = jsonObject(question.problem);
  problem.examples = examples[0];
  if (row.total) {
    const odyssey = jsonObject(problem.odyssey),
      levels = odyssey.levels;
    if (!Array.isArray(levels) || levels.length !== level)
      throw new Error("Invalid visible levels");
    for (let i = 0; i < levels.length; i++) jsonObject(levels[i]).examples = examples[i + 1];
    restorePublicExamples(problem, null);
    question.progress = {
      level: new JsonNumber(String(level)),
      completed: row.completed,
      levels,
      totalLevels: new JsonNumber(String(row.total)),
    };
  } else restorePublicExamples(problem, null);
  const signatures: Obj = { odyssey: { levels: [{ methods: [problem.signature], examples: [] }] } };
  restorePublicExamples(signatures, null);
  const cleanLevel = jsonObject((jsonObject(signatures.odyssey).levels as JsonValue[])[0]);
  problem.signature = (cleanLevel.methods as JsonValue[])[0];
  const languages = problem.languages;
  if (!Array.isArray(languages)) throw new Error("Invalid interview languages");
  problem.languages = languages.map((entry) => {
    const source = jsonObject(entry),
      safe: Obj = {};
    for (const key of ["language", "starterSource", "runtimeRevision", "harnessRevision"])
      if (source[key] !== undefined) safe[key] = source[key];
    return safe;
  });
  question.languages = languages.map((entry) => {
    const language = jsonObject(entry).language;
    if (typeof language !== "string") throw new Error("Invalid interview language");
    return language;
  });
  const privateMeta = (
    await tx.execute<{ expected: string[]; ids: string[] }>(
      sql`SELECT q.private_ids AS expected,ARRAY(SELECT c.case_id FROM interview_question_private_cases c WHERE c.session_id=q.session_id AND c.question_epoch=q.question_epoch ORDER BY c.ordinal) AS ids FROM interview_question_public q WHERE q.session_id=${id}::uuid AND q.question_epoch=${access.questionEpoch}::uuid`,
    )
  ).rows[0];
  if (
    !privateMeta ||
    privateMeta.ids.length !== privateMeta.expected.length ||
    privateMeta.ids.some((v, i) => v !== privateMeta.expected[i])
  )
    throw new Error("Interview private cases require backfill");
  const statuses = (
    await tx.execute<{ idx: number; status: string }>(
      sql`SELECT DISTINCT ON ((c->>'index')::int) (c->>'index')::int AS idx,c->>'status' AS status FROM interview_execution_public e JOIN submissions s ON s.id=e.submission_id JOIN execution_jobs j ON j.submission_id=s.id JOIN interviews i ON i.id=e.session_id CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.private_statuses)='array' AND jsonb_array_length(e.private_statuses)>0 THEN e.private_statuses WHEN jsonb_typeof(s.result->'hiddenCases')='array' THEN s.result->'hiddenCases' ELSE '[]'::jsonb END) c WHERE e.session_id=${id}::uuid AND e.question_epoch=${access.questionEpoch}::uuid AND j.language=i.language AND s.kind='submit' AND s.state='completed' AND c->>'status' IS NOT NULL AND (${access.role}='interviewer' OR EXISTS(SELECT 1 FROM interview_question_private_cases pc JOIN interview_case_visibility cv ON cv.session_id=pc.session_id AND cv.question_epoch=pc.question_epoch AND cv.case_id=pc.case_id WHERE pc.session_id=${id}::uuid AND pc.question_epoch=${access.questionEpoch}::uuid AND pc.ordinal=(c->>'index')::int)) ORDER BY (c->>'index')::int,s.admitted_at DESC,s.id DESC`,
    )
  ).rows;
  const statusByIndex = new Map(statuses.map((v) => [v.idx, v.status]));
  const cases = (
    await tx.execute<{ id: string; ordinal: number; rowVersion: string; revealed: boolean }>(
      sql`SELECT c.case_id AS id,c.ordinal,c.xmin::text AS "rowVersion",(v.case_id IS NOT NULL) AS revealed FROM interview_question_private_cases c JOIN interview_members m ON m.session_id=c.session_id AND m.user_id=${actor.userId} AND m.removed_at IS NULL LEFT JOIN interview_case_visibility v ON v.session_id=c.session_id AND v.question_epoch=c.question_epoch AND v.case_id=c.case_id WHERE c.session_id=${id}::uuid AND c.question_epoch=${access.questionEpoch}::uuid AND (m.role='interviewer' OR v.case_id IS NOT NULL) ORDER BY c.ordinal`,
    )
  ).rows.map((v) => ({
    ...v,
    ...(statusByIndex.has(v.ordinal) ? { status: statusByIndex.get(v.ordinal) } : {}),
  }));
  const marker = (revealedOnly: boolean) => {
    const key = `__quorem_stream_${nonce}_cases_${revealedOnly}__`;
    markers[key] = { kind: "cases", revealedOnly, cases };
    return key;
  };
  if (access.role === "interviewer" && cases.length) question.privateCaseDetails = marker(false);
  if (cases.some((v) => v.revealed)) question.revealedCases = marker(true);
  if (row.total) {
    const status = (
      await tx.execute<{ value: string }>(
        sql`SELECT COALESCE(jsonb_agg(jsonb_build_object('index',idx,'status',status) ORDER BY idx),'[]'::jsonb)::text AS value FROM (SELECT DISTINCT ON ((c->>'index')::int) (c->>'index')::int AS idx,c->>'status' AS status FROM interview_execution_public e JOIN submissions s ON s.id=e.submission_id JOIN execution_jobs j ON j.submission_id=s.id JOIN interviews i ON i.id=e.session_id CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.result->'publicCases')='array' THEN s.result->'publicCases' ELSE '[]'::jsonb END) c WHERE e.session_id=${id}::uuid AND e.question_epoch=${access.questionEpoch}::uuid AND j.language=i.language AND s.state='completed' AND NOT s.custom_run AND c->>'status' IS NOT NULL ORDER BY (c->>'index')::int,s.admitted_at DESC,s.id DESC) latest`,
      )
    ).rows[0];
    const statuses = parseLosslessJson(status.value);
    if (Array.isArray(statuses) && statuses.length)
      jsonObject(question.progress).caseStatuses = statuses;
  }
  if (access.role === "interviewer") {
    const events = (
      await tx.execute<{ value: string }>(
        sql`SELECT COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'userId',e.owner_id,'name',u.display_name,'kind',e.kind,'occurredAt',e.occurred_at) ORDER BY e.occurred_at,e.id),'[]'::jsonb)::text AS value FROM interview_rule_events e JOIN users u ON u.id=e.owner_id WHERE e.session_id=${id}::uuid`,
      )
    ).rows[0];
    const entries = parseLosslessJson(events.value);
    if (Array.isArray(entries) && entries.length) value.ruleEvents = entries;
  }
  if (!row.total && typeof problem.id === "string") {
    const rows = (
      await tx.execute<{ language: string }>(
        sql`SELECT language FROM problem_solutions WHERE version_id=${problem.id}::uuid AND btrim(time_complexity)<>'' AND btrim(space_complexity)<>'' ORDER BY language`,
      )
    ).rows;
    if (rows.length) problem.complexityLanguages = rows.map((item) => item.language);
  }
  value.members = parseLosslessJson(row.members);
  if (row.latest) value.latestSubmissionId = row.latest;
  if (row.invite && row.interviewer) {
    value.invitePath = `/interview-invite/${row.invite}`;
    value.invites = {
      interviewee: `/interview-invite/${row.invite}`,
      interviewer: `/interview-invite/${row.interviewer}`,
    };
  }
  return {
    json: stringifyLosslessJson(value),
    epoch: access.questionEpoch,
    version: access.version,
    role: access.role,
    markers,
  };
}
