/** @file training.ts @description Evaluated model artifacts and atomic activation/rollback. @module problems */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { day, validPredictor } from "../../../../modules/problems/recommendations/model.ts";
import type { TrainingResult } from "../../../../modules/problems/recommendations/training.ts";
export async function saveTraining(
  tx: Transaction,
  result: TrainingResult,
  expectedActive: string | null,
): Promise<{ id: string; activated: boolean }> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(740081)`);
  const current =
    (
      await tx.execute<{ id: string }>(
        sql`SELECT id::text FROM recommendation_models WHERE active AND expires_at>clock_timestamp()`,
      )
    ).rows[0]?.id ?? null;
  const id = crypto.randomUUID();
  const activated = result.eligible && current === expectedActive;
  if (!validPredictor(result.model)) throw new Error("Invalid trained predictor");
  const { model, ...report } = result;
  if (activated) await tx.execute(sql`UPDATE recommendation_models SET active=false WHERE active`);
  await tx.execute(
    sql`INSERT INTO recommendation_models(id,model,report,active) VALUES(${id}::uuid,${JSON.stringify(model)}::jsonb,${JSON.stringify(report)}::jsonb,${activated})`,
  );
  return { id, activated };
}
/** Only validated, unexpired artifacts are rollback targets; null selects the cold-start prior. */
export async function activateModel(
  tx: Transaction,
  id: string | null,
  now = Date.now(),
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(740081)`);
  if (id !== null) {
    const row = (
      await tx.execute<{ model: unknown; eligible: boolean }>(
        sql`SELECT model,report->>'eligible'='true' AS eligible FROM recommendation_models WHERE id=${id}::uuid AND expires_at>clock_timestamp()`,
      )
    ).rows[0];
    if (
      !row?.eligible ||
      !validPredictor(row.model) ||
      row.model.trainedAt < now - 30 * day ||
      row.model.trainedAt > now
    )
      throw new Error("Model is not an eligible rollback target");
  }
  await tx.execute(sql`UPDATE recommendation_models SET active=false WHERE active`);
  if (id !== null)
    await tx.execute(sql`UPDATE recommendation_models SET active=true WHERE id=${id}::uuid`);
}
