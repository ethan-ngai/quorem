/** @file feedback.ts @description Account-scoped recommendation impressions and dismissals. @module problems */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import type { RecommendationAction } from "../../../../modules/problems/ports.ts";

export async function impressionIds(
  tx: Transaction,
  owner: string,
  ids: readonly string[],
  model: string | null,
  explore: boolean,
) {
  if (!ids.length) return {};
  // Collapse polling and repeated loads into one impression opportunity per time bucket.
  const { rows } = await tx.execute<{ id: string; publication: string }>(sql`
    INSERT INTO recommendation_impressions(owner_id,publication_id,model_id,variant,position,served_at)
    SELECT ${owner}, v.id,${model}::uuid,${explore ? "explore" : "control"},x.position::int,
      date_bin(interval '15 minutes',statement_timestamp(),timestamptz '2000-01-01 UTC')
    FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) WITH ORDINALITY x(id,position)
    JOIN question_publications v ON v.id=x.id::uuid JOIN problems p ON p.current_publication_id=v.id
    WHERE p.owner_id IS NULL OR p.owner_id=${owner}
    ORDER BY v.id
    ON CONFLICT(owner_id,publication_id,variant,model_id,served_at) DO UPDATE SET id=recommendation_impressions.id
    RETURNING id::text,publication_id::text AS publication
  `);
  return Object.fromEntries(rows.map((row) => [row.publication, row.id]));
}

export async function recordFeedback(
  tx: Transaction,
  owner: string,
  ids: readonly string[],
  action: RecommendationAction,
) {
  await tx.execute(sql`
    UPDATE recommendation_impressions SET viewed_at=COALESCE(viewed_at,statement_timestamp())
      ${action === "dismiss" ? sql`,dismissed_at=COALESCE(dismissed_at,statement_timestamp())` : sql``}
    WHERE owner_id=${owner} AND id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)
      AND served_at>=statement_timestamp()-interval '1 day'
  `);
}
