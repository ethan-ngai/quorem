import { sql, type SQL } from "drizzle-orm";
import type { QuestionProblem } from "@quorem/questions";
import type { Transaction } from "@quorem/database/core";
import { runtimeForRevision } from "@quorem/execution";
import { ApplicationError } from "../../../../application/error.ts";
import { capabilitiesInTransaction } from "../../access/repository.ts";
import { insertExecutionIntent } from "../../events/dispatch.ts";
import {
  fixtureRows,
  storeCustomInput,
  type FixtureOwner,
  type bindJobInputs,
} from "../inputs/bind.ts";

export interface ExecutionAdmissionSnapshot {
  ownerId: string;
  jobId: string;
  kind: "run" | "submit";
  source: string;
  sourceHash: string;
  customRun: boolean;
  language: string;
  runtimeRevision: string;
  harnessRevision: string;
  sponsorId: string | null;
  context:
    | {
        kind: "workspace";
        workspaceId: string;
        matchId: string | null;
        matchSequence: string | null;
        admittedAt: string | null;
        odysseyLevel: number | null;
      }
    | { kind: "interview"; interviewId: string };
}
/** Owner and room/document locks must already be held; all writes use the caller's transaction. */
export async function insertAdmittedExecution(
  tx: Transaction,
  snapshot: ExecutionAdmissionSnapshot,
): Promise<{ id: string; admittedAt: string }> {
  const s = snapshot,
    runtime = runtimeForRevision(s.runtimeRevision, s.harnessRevision);
  if (!runtime || runtime.language !== s.language)
    throw new ApplicationError("temporarily_unavailable", "Execution runtime unavailable", 503);
  const busy = (
    await tx.execute<{ busy: boolean; tokens: string; daily: number }>(
      sql`SELECT EXISTS(SELECT 1 FROM submissions WHERE owner_id=${s.ownerId} AND state IN ('queued','running')) AS busy,LEAST(2,admission_tokens+EXTRACT(EPOCH FROM(clock_timestamp()-tokens_updated_at))/6.0)::text AS tokens,(SELECT count(*)::int FROM submissions WHERE owner_id=${s.ownerId} AND admitted_at>clock_timestamp()-interval '24 hours') AS daily FROM users WHERE id=${s.ownerId}`,
    )
  ).rows[0];
  if (!busy) throw new Error("Admission owner not locked");
  if (busy.busy) throw new ApplicationError("user_busy", "Another execution is active", 409);
  if (Number(busy.tokens) < 1 || busy.daily >= 100)
    throw new ApplicationError("quota_exceeded", "Execution quota reached", 429);
  if (s.sponsorId) {
    await tx.execute(
      sql`INSERT INTO guest_sponsor_locks(user_id) VALUES(${s.sponsorId}) ON CONFLICT DO NOTHING`,
    );
    await tx.execute(
      sql`SELECT user_id FROM guest_sponsor_locks WHERE user_id=${s.sponsorId} FOR UPDATE`,
    );
    const caps = await capabilitiesInTransaction(tx, s.sponsorId);
    const active = Number(
      (
        await tx.execute(
          sql`SELECT (SELECT count(*) FROM guest_execution_usage WHERE sponsor_id=${s.sponsorId} AND settled_at IS NULL)+(SELECT count(*) FROM interview_execution e JOIN interviews i ON i.id=e.session_id JOIN submissions s ON s.id=e.submission_id JOIN users u ON u.id=s.owner_id WHERE i.host_id=${s.sponsorId} AND u.kind='guest' AND s.state IN ('queued','running')) AS count`,
        )
      ).rows[0].count,
    );
    if (active >= caps.guestConcurrency)
      throw new ApplicationError(
        s.context.kind === "interview" ? "quota_exceeded" : "rate_limited",
        s.context.kind === "interview"
          ? "Host guest execution capacity reached"
          : "Another guest execution is active; try again shortly",
        429,
      );
  }
  await tx.execute(sql`SELECT pg_advisory_xact_lock(740020)`);
  if (
    Number(
      (await tx.execute(sql`SELECT count(*)::int AS count FROM execution_jobs WHERE NOT finished`))
        .rows[0].count,
    ) >= 200
  )
    throw new ApplicationError("queue_saturated", "Judge queue is full", 429);
  const id = crypto.randomUUID(),
    workspace = s.context.kind === "workspace" ? s.context : null,
    interview = s.context.kind === "interview" ? s.context : null;
  const inserted = (
    await tx.execute<{ admittedAt: string }>(
      sql`INSERT INTO submissions(id,owner_id,workspace_id,interview_id,kind,source,source_hash,state,cases,match_id,match_sequence,admitted_at,odyssey_level,custom_run,lossless_cases) VALUES(${id}::uuid,${s.ownerId},${workspace?.workspaceId ?? null}::uuid,${interview?.interviewId ?? null}::uuid,${s.kind},${s.source},${s.sourceHash},'queued','[]'::jsonb,${workspace?.matchId ?? null}::uuid,${workspace?.matchSequence ?? null}::bigint,COALESCE(${workspace?.admittedAt ?? null}::timestamptz,clock_timestamp()),${workspace?.odysseyLevel ?? null},${s.customRun},NULL) RETURNING to_char(admitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "admittedAt"`,
    )
  ).rows[0];
  await tx.execute(
    sql`INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES(${s.jobId}::uuid,${id}::uuid,${s.language},${s.runtimeRevision},${s.harnessRevision})`,
  );
  await insertExecutionIntent(tx, crypto.randomUUID(), s.jobId);
  if (s.sponsorId && workspace?.matchId)
    await tx.execute(
      sql`INSERT INTO guest_execution_usage(submission_id,match_id,sponsor_id) VALUES(${id}::uuid,${workspace.matchId}::uuid,${s.sponsorId})`,
    );
  await tx.execute(
    sql`UPDATE users SET admission_tokens=${busy.tokens}::numeric-1,tokens_updated_at=clock_timestamp() WHERE id=${s.ownerId}`,
  );
  return { id, admittedAt: inserted.admittedAt };
}

/** Select only sealed, ordered case references; custom values were validated by the caller. */
export async function prepareExecutionInputs(
  tx: Transaction,
  owner: FixtureOwner,
  kind: "run" | "submit",
  level: number,
  custom: readonly string[] | null,
  interview: boolean,
  odyssey: boolean,
): Promise<Omit<Parameters<typeof bindJobInputs>[1], "jobId" | "owner">> {
  const sealed =
    "version" in owner
      ? await tx.execute(
          sql`SELECT 1 FROM runner_version_inputs WHERE version_id=${owner.version}::uuid AND sealed`,
        )
      : await tx.execute(
          sql`SELECT 1 FROM runner_snapshot_inputs WHERE session_id=${owner.session}::uuid AND fixture_id=${owner.fixture}::bytea AND sealed`,
        );
  if (!sealed.rows.length)
    throw new ApplicationError("temporarily_unavailable", "Execution fixture unavailable", 503);
  const counts = (
    await tx.execute<{ examples: string; hidden: string }>(
      sql`SELECT count(*) FILTER (WHERE channel='example')::text AS examples,count(*) FILTER (WHERE channel='hidden')::text AS hidden FROM (${fixtureRows(owner, level)}) f`,
    )
  ).rows[0];
  const examples = Number(counts.examples),
    hidden = Number(counts.hidden);
  const fallback = interview && kind === "submit" && !odyssey && hidden === 0;
  const primary = custom ? "custom" : kind === "run" || fallback ? "example" : "hidden";
  const customHashes: Uint8Array[] = [];
  if (custom) for (const raw of custom) customHashes.push(await storeCustomInput(tx, raw));
  const caseCount =
    primary === "custom" ? customHashes.length : primary === "example" ? examples : hidden;
  if (interview && caseCount === 0)
    throw new ApplicationError("invalid_input", "No tests configured", 400);
  return {
    level,
    primary,
    custom: customHashes,
    caseCount,
    sampleCount: kind === "submit" ? examples : 0,
    privateDetails: interview,
    submitCasesAreSamples: fallback,
  };
}

/** Project only bounded validator inputs; descriptive text and examples stay in PostgreSQL. */
export async function customValidationMetadata(
  tx: Transaction,
  owner: FixtureOwner,
  level = 0,
): Promise<QuestionProblem> {
  if (!Number.isSafeInteger(level) || level < 0 || level > 8)
    throw new Error("Invalid fixture stage");
  const source =
    "version" in owner
      ? sql`SELECT jsonb_build_object('signature',signature,'constraints',constraints,'limits',limits,'sql',sql_config,'odyssey',odyssey) AS problem FROM problem_versions WHERE id=${owner.version}::uuid`
      : sql`SELECT question->'problem' AS problem FROM interviews WHERE id=${owner.session}::uuid`;
  const signature = (value: SQL) => sql`jsonb_strip_nulls(jsonb_build_object(
    'className',${value}->'className','methodName',${value}->'methodName','returnType',${value}->'returnType','outputOrder',${value}->'outputOrder',
    'parameters',to_jsonb(ARRAY(SELECT jsonb_strip_nulls(jsonb_build_object('name',p.value->'name','type',p.value->'type','input',CASE WHEN p.value->'input' IS NULL OR p.value->'input'='null'::jsonb THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object('preset',p.value->'input'->'preset','rows',p.value->'input'->'rows')) END)) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${value}->'parameters')='array' THEN ${value}->'parameters' ELSE '[]'::jsonb END) WITH ORDINALITY p(value,ordinality) ORDER BY p.ordinality LIMIT 17))))`;
  const sig = signature(sql`s.problem->'signature'`),
    method = signature(sql`m.value`);
  const target = (value: SQL) =>
    sql`CASE WHEN ${value} IS NULL OR ${value}='null'::jsonb THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object('parameter',${value}->'parameter','projection',${value}->'projection')) END`;
  const constraintTarget = target(sql`c.value->'target'`),
    constraintLeft = target(sql`c.value->'left'`),
    constraintRight = target(sql`c.value->'right'`);
  const compact = sql`jsonb_strip_nulls(jsonb_build_object(
    'signature',${sig},
    'limits',jsonb_build_object('maxCollectionElements',s.problem->'limits'->'maxCollectionElements'),
    'constraints',to_jsonb(ARRAY(SELECT jsonb_strip_nulls(jsonb_build_object('kind',c.value->'kind','target',${constraintTarget},'left',${constraintLeft},'right',${constraintRight},'min',c.value->'min','max',c.value->'max','operator',c.value->'operator','property',c.value->'property')) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.problem->'constraints')='array' THEN s.problem->'constraints' ELSE '[]'::jsonb END) WITH ORDINALITY c(value,ordinality) WHERE c.value->>'kind'<>'prose' ORDER BY c.ordinality LIMIT 65)),
    'odyssey',CASE WHEN jsonb_typeof(s.problem->'odyssey'->'levels')='array' THEN jsonb_build_object('levels',to_jsonb(ARRAY(SELECT jsonb_build_object('methods',to_jsonb(ARRAY(SELECT ${method} FROM jsonb_array_elements(CASE WHEN jsonb_typeof(l.value->'methods')='array' THEN l.value->'methods' ELSE '[]'::jsonb END) WITH ORDINALITY m(value,ordinality) ORDER BY m.ordinality LIMIT 17))) FROM jsonb_array_elements(s.problem->'odyssey'->'levels') WITH ORDINALITY l(value,ordinality) ORDER BY l.ordinality LIMIT ${level}))) ELSE NULL END,
    'sql',CASE WHEN jsonb_typeof(s.problem->'sql')='object' THEN jsonb_build_object('dialect',s.problem->'sql'->'dialect','outputOrder',s.problem->'sql'->'outputOrder','tables',to_jsonb(ARRAY(SELECT jsonb_build_object('name',t.value->'name','columns',to_jsonb(ARRAY(SELECT jsonb_build_object('name',c.value->'name','type',c.value->'type') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.value->'columns')='array' THEN t.value->'columns' ELSE '[]'::jsonb END) WITH ORDINALITY c(value,ordinality) ORDER BY c.ordinality LIMIT 33))) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.problem->'sql'->'tables')='array' THEN s.problem->'sql'->'tables' ELSE '[]'::jsonb END) WITH ORDINALITY t(value,ordinality) ORDER BY t.ordinality LIMIT 17)),'output',to_jsonb(ARRAY(SELECT jsonb_build_object('name',c.value->'name','type',c.value->'type') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.problem->'sql'->'output')='array' THEN s.problem->'sql'->'output' ELSE '[]'::jsonb END) WITH ORDINALITY c(value,ordinality) ORDER BY c.ordinality LIMIT 33))) ELSE NULL END))`;
  const row = (
    await tx.execute<{ data: string | null }>(
      sql`WITH source AS (${source}), projected AS (SELECT ${compact} AS value FROM source s) SELECT CASE WHEN octet_length(value::text)<=5242880 THEN value::text ELSE NULL END AS data FROM projected`,
    )
  ).rows[0];
  if (!row?.data)
    throw new ApplicationError("temporarily_unavailable", "Execution metadata unavailable", 503);
  const metadata = JSON.parse(row.data) as QuestionProblem;
  const levels = metadata.odyssey?.levels ?? [];
  if (
    metadata.signature.parameters.length > 16 ||
    metadata.constraints.length > 64 ||
    levels.length > 8 ||
    levels.some(
      (level) =>
        level.methods.length > 16 || level.methods.some((method) => method.parameters.length > 16),
    ) ||
    (metadata.sql &&
      ((metadata.sql.tables?.length ?? 0) > 16 ||
        (metadata.sql.output?.length ?? 0) > 32 ||
        metadata.sql.tables?.some((table) => table.columns.length > 32)))
  )
    throw new ApplicationError("temporarily_unavailable", "Execution metadata unavailable", 503);
  return metadata;
}
