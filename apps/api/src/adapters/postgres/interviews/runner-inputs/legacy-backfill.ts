/** @file legacy-backfill.ts @description Privileged, bounded legacy interview input normalization. @module interviews */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { setActiveRunnerFixture } from "./active.ts";
import {
  savePublishedInterviewSidecars,
  copySnapshotExamples,
} from "../question/published-sidecars.ts";
import { normalizeSnapshot } from "./legacy-snapshot.ts";
type Run = <T>(fn: (scope: Pick<ConnectionScope, "transaction">) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 30000, lockTimeoutMs: 1000 };

async function snapshotActive(
  tx: Transaction,
  session: string,
  epoch: string,
): Promise<{ fixture: Uint8Array; source: Uint8Array } | undefined> {
  const result = await tx.execute<{
    fixture: Uint8Array;
    source: Uint8Array;
  }>(sql`WITH original AS (
    SELECT id,question,lossless_question,sha256(COALESCE(lossless_question,convert_to(question::text,'UTF8'))) AS source
    FROM interviews WHERE id=${session}::uuid AND question_epoch=${epoch}::uuid FOR UPDATE
  ), input AS (
    SELECT id,source,lossless_question,CASE WHEN lossless_question IS NULL THEN question ELSE jsonb_set(question,'{_lossless_sha256}',to_jsonb(encode(sha256(lossless_question),'hex'))) END AS fixture FROM original
  ), payload AS (
    SELECT id,source,fixture,lossless_question,sha256(convert_to(fixture::text,'UTF8')) AS fixture_id FROM input
  ), inserted AS (
    INSERT INTO interview_question_snapshots(session_id,id,fixture,lossless_fixture) SELECT id,fixture_id,fixture,lossless_question FROM payload ON CONFLICT(session_id,id) DO NOTHING RETURNING id
  ) SELECT p.fixture_id AS fixture,p.source FROM payload p WHERE EXISTS(SELECT 1 FROM inserted WHERE id=p.fixture_id) OR EXISTS(SELECT 1 FROM interview_question_snapshots q WHERE q.session_id=p.id AND q.id=p.fixture_id AND q.fixture=p.fixture AND q.lossless_fixture IS NOT DISTINCT FROM p.lossless_question)`);
  return result.rows[0];
}
async function compactActive(
  tx: Transaction,
  session: string,
  epoch: string,
  sourceHash: Uint8Array,
): Promise<void> {
  await tx.execute(sql`SELECT set_config('quorem.lossless_case_write','v1',true)`);
  const changed = await tx.execute(sql`WITH source AS (
    SELECT id,question,question->'problem' AS problem FROM interviews WHERE id=${session}::uuid AND question_epoch=${epoch}::uuid AND sha256(COALESCE(lossless_question,convert_to(question::text,'UTF8')))=${sourceHash}
  ), projected AS (
    SELECT id,question,jsonb_set(problem,'{examples}',COALESCE((SELECT jsonb_agg('{}'::jsonb ORDER BY n) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(problem->'examples')='array' THEN problem->'examples' ELSE '[]'::jsonb END) WITH ORDINALITY e(value,n)),'[]'::jsonb),true) AS problem FROM source
  ), staged AS (
    SELECT id,question,CASE WHEN jsonb_typeof(problem->'odyssey'->'levels')='array' THEN jsonb_set(problem,'{odyssey,levels}',(SELECT COALESCE(jsonb_agg(jsonb_set(level,'{examples}',COALESCE((SELECT jsonb_agg('{}'::jsonb ORDER BY j) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(level->'examples')='array' THEN level->'examples' ELSE '[]'::jsonb END) WITH ORDINALITY x(example,j)),'[]'::jsonb),true) ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(problem->'odyssey'->'levels') WITH ORDINALITY s(level,n)),true) ELSE problem END AS problem FROM projected
  ) UPDATE interviews i SET question=jsonb_set(jsonb_set(jsonb_set(s.question,'{problem}',s.problem,true),'{hiddenCases}',COALESCE((SELECT jsonb_agg('{}'::jsonb ORDER BY n) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.question->'hiddenCases')='array' THEN s.question->'hiddenCases' ELSE '[]'::jsonb END) WITH ORDINALITY h(value,n)),'[]'::jsonb),true),'{odysseyHiddenCases}',COALESCE((SELECT jsonb_agg(COALESCE((SELECT jsonb_agg('{}'::jsonb ORDER BY j) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(stage)='array' THEN stage ELSE '[]'::jsonb END) WITH ORDINALITY c(value,j)),'[]'::jsonb) ORDER BY n) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.question->'odysseyHiddenCases')='array' THEN s.question->'odysseyHiddenCases' ELSE '[]'::jsonb END) WITH ORDINALITY h(stage,n)),'[]'::jsonb),true),lossless_question=NULL FROM staged s WHERE i.id=s.id RETURNING i.id`);
  if (!changed.rows.length) throw new Error("Active fixture changed");
}

/** One transaction owns the row lock, source identity, index, sidecars and epoch mapping. */
export async function backfillActiveRunnerInput(
  tx: Transaction,
  session: string,
  epoch: string,
): Promise<boolean> {
  const existing = (
    await tx.execute<{ mapped: boolean; compact: boolean; ready: boolean }>(
      sql`SELECT (a.session_id IS NOT NULL) AS mapped,i.lossless_question IS NULL AS compact,(ARRAY(SELECT p.level FROM interview_public_examples p WHERE p.session_id=i.id AND p.question_epoch=i.question_epoch ORDER BY p.level)=ARRAY(SELECT generate_series(0,CASE WHEN jsonb_typeof(q.metadata->'problem'->'odyssey'->'levels')='array' THEN jsonb_array_length(q.metadata->'problem'->'odyssey'->'levels') ELSE 0 END)) AND ARRAY(SELECT c.case_id FROM interview_question_private_cases c WHERE c.session_id=i.id AND c.question_epoch=i.question_epoch ORDER BY c.ordinal)=q.private_ids) AS ready FROM interviews i JOIN interview_question_public q ON q.session_id=i.id AND q.question_epoch=i.question_epoch LEFT JOIN interview_active_runner_inputs a ON a.session_id=i.id AND a.question_epoch=i.question_epoch WHERE i.id=${session}::uuid AND i.question_epoch=${epoch}::uuid FOR UPDATE OF i`,
    )
  ).rows[0];
  if (!existing) return false;
  if (existing.mapped && existing.compact) {
    if (!existing.ready) {
      const source = (
        await tx.execute<{
          version: string;
          fixture: Uint8Array;
          private_ready: boolean;
          public_ready: boolean;
        }>(
          sql`SELECT ARRAY(SELECT p.level FROM interview_public_examples p WHERE p.session_id=q.session_id AND p.question_epoch=q.question_epoch ORDER BY p.level)=ARRAY(SELECT generate_series(0,CASE WHEN jsonb_typeof(q.metadata->'problem'->'odyssey'->'levels')='array' THEN jsonb_array_length(q.metadata->'problem'->'odyssey'->'levels') ELSE 0 END)) AS public_ready,ARRAY(SELECT c.case_id FROM interview_question_private_cases c WHERE c.session_id=q.session_id AND c.question_epoch=q.question_epoch ORDER BY c.ordinal)=q.private_ids AS private_ready,q.metadata->'problem'->>'id' AS version,a.fixture_id AS fixture FROM interview_question_public q JOIN interview_active_runner_inputs a ON a.session_id=q.session_id AND a.question_epoch=q.question_epoch WHERE q.session_id=${session}::uuid AND q.question_epoch=${epoch}::uuid`,
        )
      ).rows[0];
      if (!source?.version) throw new Error("Indexed interview source unavailable");
      if (!source.private_ready)
        await normalizeSnapshot(tx, session, source.fixture, [epoch], epoch);
      if (!source.public_ready)
        await savePublishedInterviewSidecars(tx, session, epoch, source.version, true);
      const complete = (
        await tx.execute<{ ok: boolean }>(
          sql`SELECT (ARRAY(SELECT c.case_id FROM interview_question_private_cases c WHERE c.session_id=q.session_id AND c.question_epoch=q.question_epoch ORDER BY c.ordinal)=q.private_ids AND ARRAY(SELECT p.level FROM interview_public_examples p WHERE p.session_id=q.session_id AND p.question_epoch=q.question_epoch ORDER BY p.level)=ARRAY(SELECT generate_series(0,CASE WHEN jsonb_typeof(q.metadata->'problem'->'odyssey'->'levels')='array' THEN jsonb_array_length(q.metadata->'problem'->'odyssey'->'levels') ELSE 0 END))) AS ok FROM interview_question_public q WHERE q.session_id=${session}::uuid AND q.question_epoch=${epoch}::uuid`,
        )
      ).rows[0]?.ok;
      if (!complete) throw new Error("Original private cases required for repair");
      await copySnapshotExamples(tx, session, epoch, source.fixture);
    }
    return true;
  }
  const snapshot = await snapshotActive(tx, session, epoch);
  if (!snapshot) return false;
  await normalizeSnapshot(tx, session, snapshot.fixture, [epoch], epoch);
  await compactActive(tx, session, epoch, snapshot.source);
  const coherent = (
    await tx.execute<{ ok: boolean }>(
      sql`SELECT (ARRAY(SELECT p.level FROM interview_public_examples p WHERE p.session_id=q.session_id AND p.question_epoch=q.question_epoch ORDER BY p.level)=ARRAY(SELECT generate_series(0,CASE WHEN jsonb_typeof(q.metadata->'problem'->'odyssey'->'levels')='array' THEN jsonb_array_length(q.metadata->'problem'->'odyssey'->'levels') ELSE 0 END)) AND ARRAY(SELECT c.case_id FROM interview_question_private_cases c WHERE c.session_id=q.session_id AND c.question_epoch=q.question_epoch ORDER BY c.ordinal)=q.private_ids) AS ok FROM interview_question_public q WHERE q.session_id=${session}::uuid AND q.question_epoch=${epoch}::uuid`,
    )
  ).rows[0]?.ok;
  if (!coherent) throw new Error("Active fixture projection conflict");
  await setActiveRunnerFixture(tx, session, epoch, snapshot.fixture);
  return true;
}
/** Existing submission fixture IDs remain unchanged; normalize at most 16 epochs per transaction. */
export async function backfillHistoricalRunnerInput(
  tx: Transaction,
  session: string,
  fixture: Uint8Array,
): Promise<boolean> {
  const exists = (
    await tx.execute(
      sql`SELECT 1 FROM interview_question_snapshots WHERE session_id=${session}::uuid AND id=${fixture} FOR SHARE`,
    )
  ).rows.length;
  if (!exists) return false;
  const epochs = (
    await tx.execute<{ epoch: string }>(
      sql`SELECT DISTINCT e.question_epoch::text AS epoch FROM interview_execution e JOIN interview_snapshot_public q ON q.session_id=e.session_id AND q.fixture_id=e.fixture_id WHERE e.session_id=${session}::uuid AND e.fixture_id=${fixture} AND ARRAY(SELECT c.case_id FROM interview_question_private_cases c WHERE c.session_id=e.session_id AND c.question_epoch=e.question_epoch ORDER BY c.ordinal) IS DISTINCT FROM q.private_ids ORDER BY epoch LIMIT 16`,
    )
  ).rows.map((row) => row.epoch);
  await normalizeSnapshot(tx, session, fixture, epochs);
  return true;
}

/** One bounded batch; old writers must be drained before declaring completion. */
export async function backfillRunnerInputsBatch(
  run: Run,
  limit = 8,
): Promise<{ attempted: number; completed: number }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
    throw new RangeError("Invalid batch limit");
  const active = await run((scope) =>
    scope.transaction(
      { ...options, readOnly: true },
      async (tx) =>
        (
          await tx.execute<{ id: string; epoch: string }>(
            sql`SELECT i.id::text,i.question_epoch::text AS epoch FROM interviews i JOIN interview_question_public q ON q.session_id=i.id AND q.question_epoch=i.question_epoch LEFT JOIN interview_active_runner_inputs a ON a.session_id=i.id AND a.question_epoch=i.question_epoch WHERE a.session_id IS NULL OR i.lossless_question IS NOT NULL OR ARRAY(SELECT p.level FROM interview_public_examples p WHERE p.session_id=i.id AND p.question_epoch=i.question_epoch ORDER BY p.level) IS DISTINCT FROM ARRAY(SELECT generate_series(0,CASE WHEN jsonb_typeof(q.metadata->'problem'->'odyssey'->'levels')='array' THEN jsonb_array_length(q.metadata->'problem'->'odyssey'->'levels') ELSE 0 END)) OR ARRAY(SELECT c.case_id FROM interview_question_private_cases c WHERE c.session_id=i.id AND c.question_epoch=i.question_epoch ORDER BY c.ordinal) IS DISTINCT FROM q.private_ids ORDER BY i.id LIMIT ${limit}`,
          )
        ).rows,
    ),
  );
  let completed = 0;
  for (const item of active)
    if (
      await run((scope) =>
        scope.transaction(options, (tx) => backfillActiveRunnerInput(tx, item.id, item.epoch)),
      )
    )
      completed++;
  const remaining = limit - active.length;
  const snapshots = remaining
    ? await run((scope) =>
        scope.transaction(
          { ...options, readOnly: true },
          async (tx) =>
            (
              await tx.execute<{ id: string; fixture: Uint8Array }>(
                sql`SELECT q.session_id::text AS id,q.fixture_id AS fixture FROM interview_snapshot_public q LEFT JOIN runner_snapshot_inputs r ON r.session_id=q.session_id AND r.fixture_id=q.fixture_id AND r.sealed WHERE r.session_id IS NULL OR ARRAY(SELECT p.level FROM interview_snapshot_public_examples p WHERE p.session_id=q.session_id AND p.fixture_id=q.fixture_id ORDER BY p.level) IS DISTINCT FROM ARRAY(SELECT generate_series(0,q.total_stages)) OR EXISTS(SELECT 1 FROM interview_execution e WHERE e.session_id=q.session_id AND e.fixture_id=q.fixture_id AND ARRAY(SELECT c.case_id FROM interview_question_private_cases c WHERE c.session_id=e.session_id AND c.question_epoch=e.question_epoch ORDER BY c.ordinal) IS DISTINCT FROM q.private_ids) ORDER BY q.session_id,q.fixture_id LIMIT ${remaining}`,
              )
            ).rows,
        ),
      )
    : [];
  for (const item of snapshots)
    if (
      await run((scope) =>
        scope.transaction(options, (tx) =>
          backfillHistoricalRunnerInput(tx, item.id, item.fixture),
        ),
      )
    )
      completed++;
  if (active.length + snapshots.length === 0) {
    const pending = await run((scope) =>
      scope.transaction(
        { ...options, readOnly: true },
        async (tx) =>
          (
            await tx.execute<{ pending: boolean }>(
              sql`SELECT EXISTS(SELECT 1 FROM execution_jobs j JOIN interview_execution e ON e.submission_id=j.submission_id LEFT JOIN runner_job_inputs r ON r.job_id=j.id AND r.sealed WHERE NOT j.finished AND r.job_id IS NULL) AS pending`,
            )
          ).rows[0].pending,
      ),
    );
    if (pending) throw new Error("Legacy interview jobs must drain before cutover");
  }
  return { attempted: active.length + snapshots.length, completed };
}
