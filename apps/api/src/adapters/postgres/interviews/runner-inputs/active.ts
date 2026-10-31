/** @file active.ts @description Epoch-fenced active interview input identity. @module interviews */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
/** Caller owns the locked question mutation and has already sealed its snapshot index. */
export async function setActiveRunnerFixture(
  tx: Transaction,
  sessionId: string,
  questionEpoch: string,
  fixtureId: Uint8Array,
): Promise<void> {
  await tx.execute(
    sql`INSERT INTO interview_active_runner_inputs(session_id,question_epoch,fixture_id) VALUES(${sessionId}::uuid,${questionEpoch}::uuid,${fixtureId}::bytea) ON CONFLICT(session_id) DO UPDATE SET question_epoch=EXCLUDED.question_epoch,fixture_id=EXCLUDED.fixture_id`,
  );
}
/**
 * Pin a question already derived by the canonical question writer from a sealed version.
 * The database copies case references and snapshot bytes; no private fixture crosses the Worker.
 */
export async function createActiveRunnerFixture(
  tx: Transaction,
  sessionId: string,
  questionEpoch: string,
  versionId: string,
): Promise<Uint8Array> {
  const row = (
    await tx.execute<{
      fixture: Uint8Array;
      metadata: Uint8Array;
      fixture_hash: Uint8Array;
      copy_hidden: boolean;
    }>(sql`
    WITH source AS (
      SELECT i.id,i.lossless_question,
        CASE WHEN i.lossless_question IS NULL THEN i.question ELSE jsonb_set(i.question,'{_lossless_sha256}',to_jsonb(encode(sha256(i.lossless_question),'hex'))) END AS fixture,
        v.metadata_hash,
        COALESCE(jsonb_typeof(i.question->'problem'->'odyssey'),'null') <> 'null' OR COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(i.question->'hiddenCases')='array' THEN i.question->'hiddenCases' ELSE '[]'::jsonb END),0)>0 AS copy_hidden
      FROM interviews i JOIN runner_version_inputs v ON v.version_id=${versionId}::uuid AND v.sealed
      WHERE i.id=${sessionId}::uuid AND i.question_epoch=${questionEpoch}::uuid AND i.question->'problem'->>'id'=${versionId} FOR UPDATE OF i
    ), payload AS (
      SELECT id,fixture,lossless_question,metadata_hash,copy_hidden,sha256(convert_to(fixture::text,'UTF8')) AS fixture_id,sha256(COALESCE(lossless_question,convert_to(fixture::text,'UTF8'))) AS fixture_hash FROM source
    ), inserted AS (
      INSERT INTO interview_question_snapshots(session_id,id,fixture,lossless_fixture)
      SELECT id,fixture_id,fixture,lossless_question FROM payload ON CONFLICT(session_id,id) DO NOTHING RETURNING id
    )
    SELECT p.fixture_id AS fixture,p.metadata_hash AS metadata,p.fixture_hash,p.copy_hidden FROM payload p
    WHERE EXISTS(SELECT 1 FROM inserted WHERE id=p.fixture_id) OR EXISTS(SELECT 1 FROM interview_question_snapshots s WHERE s.session_id=p.id AND s.id=p.fixture_id AND s.fixture=p.fixture AND s.lossless_fixture IS NOT DISTINCT FROM p.lossless_question)`)
  ).rows[0];
  if (!row) throw new Error("Runner fixture unavailable");
  const existing = (
    await tx.execute<{ sealed: boolean; same: boolean }>(
      sql`SELECT sealed,(metadata_hash=${row.metadata}::bytea AND fixture_hash=${row.fixture_hash}::bytea) AS same FROM runner_snapshot_inputs WHERE session_id=${sessionId}::uuid AND fixture_id=${row.fixture}::bytea`,
    )
  ).rows[0];
  if (existing) {
    if (!existing.sealed || !existing.same) throw new Error("Conflicting runner fixture");
  } else {
    await tx.execute(
      sql`INSERT INTO runner_snapshot_inputs(session_id,fixture_id,metadata_hash,fixture_hash) VALUES(${sessionId}::uuid,${row.fixture},${row.metadata},${row.fixture_hash})`,
    );
    await tx.execute(
      sql`INSERT INTO runner_snapshot_input_cases(session_id,fixture_id,channel,stage,ordinal,blob_hash) SELECT ${sessionId}::uuid,${row.fixture},channel,stage,ordinal,blob_hash FROM runner_version_input_cases WHERE version_id=${versionId}::uuid AND (channel<>'hidden' OR ${row.copy_hidden})`,
    );
    await tx.execute(
      sql`UPDATE runner_snapshot_inputs SET sealed=true WHERE session_id=${sessionId}::uuid AND fixture_id=${row.fixture}`,
    );
  }
  await setActiveRunnerFixture(tx, sessionId, questionEpoch, row.fixture);
  return row.fixture;
}
