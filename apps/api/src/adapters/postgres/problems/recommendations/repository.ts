/** @file repository.ts @description Authorized learning snapshots. @module problems */
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
  // Use whole learner histories for evaluation. A raw-event limit rewards retry spam
  // by throwing away unrelated practice before the learner ever sees it.
  const eligible =
    owners === null
      ? sql`JOIN problem_versions v ON v.id=e.version_id JOIN problems p ON p.id=v.problem_id
      JOIN users u ON u.id=e.owner_id WHERE p.owner_id IS NULL AND u.kind='account' AND NOT u.disabled`
      : sql`WHERE e.owner_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(owners)}::jsonb))`;
  const rows = (
    await tx.execute<LearningEvent>(sql`
    WITH sessions AS MATERIALIZED (
      SELECT min(e.submission_id::text) AS "eventId",e.owner_id AS owner,e.version_id::text AS id,
        e.difficulty,e.tags,e.context, bool_or(e.accepted) AS accepted,
        least(count(*)::int,20) AS attempts, bool_or(e.assisted) AS assisted,
        (extract(epoch FROM e.session_end)*1000)::double precision AS at
      FROM question_learning_observations e ${eligible}
      GROUP BY e.owner_id,e.version_id,e.difficulty,e.tags,e.context,e.session_end
    )
    ${
      owners === null
        ? sql`, cohort AS (
      SELECT owner,sum(count(*)) OVER (ORDER BY md5(owner),owner) AS observations
      FROM sessions GROUP BY owner
    )`
        : sql``
    }
    SELECT sessions.* FROM sessions
    ${owners === null ? sql`JOIN cohort USING(owner) WHERE cohort.observations<=20000` : sql``}
    ORDER BY at,"eventId"`)
  ).rows;
  return rows;
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
    modelId: model.model.trainedAt ? model.id : null,
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
    await tx.execute<LearningQuestion>(sql`SELECT v.id::text AS id,v.difficulty,
    ARRAY(SELECT tag FROM problem_tags WHERE version_id=v.id ORDER BY ordinal) AS tags
    FROM problem_versions v
    WHERE v.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)`)
  ).rows;
  return rows;
}
