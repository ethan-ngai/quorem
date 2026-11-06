/** @file repository.ts @description Authorized learning snapshots and revision-bound vectors. @module problems */
import { attachEmbeddings } from "./embeddings.ts";
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import {
  day,
  prior,
  validPredictor,
  type LearningEvent,
  type LearningQuestion,
  type Predictor,
} from "../../../../modules/problems/recommendations/model.ts";
import type { RecommendationContext } from "../../../../modules/problems/recommendations/ranking.ts";
export type ModelSnapshot = { id: string | null; model: Predictor };
export async function activeModel(tx: Transaction, now = Date.now()): Promise<ModelSnapshot> {
  const row = (
    await tx.execute<{ id: string; model: unknown }>(
      sql`SELECT id::text,model FROM recommendation_models WHERE active AND expires_at>clock_timestamp() LIMIT 1`,
    )
  ).rows[0];
  return row &&
    validPredictor(row.model) &&
    row.model.trainedAt <= now &&
    row.model.trainedAt >= now - 30 * day
    ? { id: row.id, model: row.model }
    : { id: row?.id ?? null, model: prior() };
}
export async function learningEvents(
  tx: Transaction,
  owners: readonly string[] | null,
): Promise<LearningEvent[]> {
  if (owners?.length === 0) return [];
  // A global fit uses public account outcomes only; private work stays in its owner's profile.
  const rows = (
    await tx.execute<
      LearningQuestion & {
        eventId: string;
        owner: string;
        accepted: boolean;
        context: "practice" | "match";
        at: number;
      }
    >(sql`
    SELECT e.submission_id::text AS "eventId",e.owner_id AS owner,e.version_id::text AS id,e.content_key AS key,
      e.difficulty,e.tags,e.accepted,e.context,(extract(epoch FROM e.observed_at)*1000)::double precision AS at
    FROM ${owners === null ? sql`question_learning_events` : sql`(SELECT recent.* FROM (SELECT jsonb_array_elements_text(${JSON.stringify([...new Set(owners)])}::jsonb) AS owner) people CROSS JOIN LATERAL (SELECT * FROM question_learning_events WHERE owner_id=people.owner ORDER BY observed_at DESC,submission_id DESC LIMIT 512) recent)`} e JOIN problem_versions v ON v.id=e.version_id JOIN problems p ON p.id=v.problem_id
    JOIN users u ON u.id=e.owner_id
    WHERE e.observed_at>clock_timestamp()-interval '180 days'
      AND ${owners === null ? sql`p.owner_id IS NULL AND u.kind='account' AND NOT u.disabled` : sql`e.owner_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(owners)}::jsonb))`}
    ORDER BY e.observed_at DESC,e.submission_id DESC LIMIT 20000`)
  ).rows;
  return attachEmbeddings(tx, rows);
}
export async function recommendationContext(
  tx: Transaction,
  owners: readonly string[],
): Promise<RecommendationContext> {
  const model = await activeModel(tx);
  const events = await learningEvents(tx, owners);
  const exposures = owners.length
    ? (
        await tx.execute<{ owner: string; id: string; lastSeen: string }>(
          sql`SELECT owner_id AS owner,version_id::text AS id,last_seen_at::text AS "lastSeen" FROM question_exposure WHERE owner_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(owners)}::jsonb))`,
        )
      ).rows
    : [];
  return {
    model: model.model,
    events,
    exposures: exposures.map((row) => ({ ...row, lastSeen: Date.parse(row.lastSeen) })),
  };
}
export async function learningQuestions(
  tx: Transaction,
  ids: readonly string[],
): Promise<LearningQuestion[]> {
  if (!ids.length) return [];
  const rows = (
    await tx.execute<LearningQuestion>(sql`SELECT v.id::text AS id,recommendation_content_key(v.id) AS key,v.difficulty,
    ARRAY(SELECT tag FROM problem_tags WHERE version_id=v.id ORDER BY ordinal) AS tags
    FROM problem_versions v
    WHERE v.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)`)
  ).rows;
  return attachEmbeddings(tx, rows);
}
