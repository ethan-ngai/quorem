/** @file fixture.ts @description Immutable admitted fixture identity and public sidecars. @module interviews */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { storageProjection } from "../../problems/storage.ts";
import { indexRunnerFixture } from "../../judging/inputs/fixture.ts";
import { saveSnapshotPublicExamples } from "../question/public-examples.ts";
export async function saveInterviewFixture(
  tx: Transaction,
  id: string,
  raw: string,
): Promise<Uint8Array> {
  const { safe, lossless } = storageProjection(raw);
  const rows = await tx.execute<{ id: Uint8Array }>(
    sql`WITH input AS (SELECT ${id}::uuid AS session_id,CASE WHEN ${lossless}::bytea IS NULL THEN ${safe}::jsonb ELSE jsonb_set(${safe}::jsonb,'{_lossless_sha256}',to_jsonb(encode(sha256(${lossless}::bytea),'hex'))) END AS fixture,${lossless}::bytea AS lossless_fixture), payload AS (SELECT session_id,sha256(convert_to(fixture::text,'UTF8')) AS id,fixture,lossless_fixture FROM input), inserted AS (INSERT INTO interview_question_snapshots(session_id,id,fixture,lossless_fixture) SELECT session_id,id,fixture,lossless_fixture FROM payload ON CONFLICT(session_id,id) DO NOTHING RETURNING id) SELECT id FROM inserted UNION ALL SELECT s.id FROM interview_question_snapshots s JOIN payload p ON s.session_id=p.session_id AND s.id=p.id AND s.fixture=p.fixture AND s.lossless_fixture IS NOT DISTINCT FROM p.lossless_fixture LIMIT 1`,
  );
  const fixture = rows.rows[0]?.id;
  if (!fixture) throw new Error("Interview fixture hash collision");
  await saveSnapshotPublicExamples(tx, id, fixture, raw);
  await indexRunnerFixture(tx, { session: id, fixture }, raw);
  return fixture;
}
