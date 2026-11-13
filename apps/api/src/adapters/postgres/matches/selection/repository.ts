/** @file repository.ts @description Authorized match problem selection. @module matches */
import { matchRecommendationCandidates } from "../../../../modules/problems/recommendations/ranking.ts";
import {
  recommendationContext,
  learningQuestions,
} from "../../problems/recommendations/repository.ts";
import { defaultCatalogFormat } from "@quorem/contracts/catalog-filter";
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type { Settings } from "../../../../modules/matches/lifecycle/model.ts";
import type { CandidateCriteria } from "../../../../modules/problems/model.ts";
import { readCandidates } from "../../problems/queries/repository.ts";
const noMatchingQuestions = (optimal = false) =>
  new ApplicationError(
    "no_matching_questions",
    optimal
      ? "No questions match the filters and optimal target"
      : "No questions match the selected filters",
    409,
  );
export async function validateSelectedMatchProblem(tx: Transaction, owner: string, s: Settings) {
  if (!s.selectedProblemVersionId) return;
  if (
    !(
      await tx.execute(
        sql`SELECT 1 FROM question_publications v JOIN problems p ON p.id=v.problem_id WHERE v.id::text=${s.selectedProblemVersionId} AND p.current_publication_id=v.id AND v.sealed AND (p.owner_id IS NULL OR p.owner_id=${owner})`,
      )
    ).rows.length
  )
    throw new ApplicationError("invalid_input", "Problem not found", 400);
}
function choice<T>(items: readonly T[]): T {
  const bound = Math.floor(0x100000000 / items.length) * items.length;
  const n = new Uint32Array(1);
  do crypto.getRandomValues(n);
  while (n[0] >= bound);
  return items[n[0] % items.length];
}
/** Select and pin the current sealed candidate before activation. */
export async function selectMatchCandidate(
  tx: Transaction,
  owner: string,
  settings: Settings,
  participants: readonly string[],
  matchId?: string,
) {
  await validateSelectedMatchProblem(tx, owner, settings);
  const f = settings.questionFilters;
  const criteria: CandidateCriteria = {
    selectedPublicationId: settings.selectedProblemVersionId,
    difficulty: settings.difficulties.join(","),
    type: f.type === "odyssey" ? f.type : defaultCatalogFormat,
    sql: f.sql === "true" ? "true" : "false",
    topic: f.topic ?? "",
    topicMatch: f.topicMatch,
    company: f.company ?? "",
    companyMatch: f.companyMatch,
  };
  const available = await readCandidates(tx, { userId: owner }, criteria);
  const permitted = (
    await tx.execute<{ id: string }>(
      sql`SELECT id::text AS id FROM question_publications WHERE sealed
        AND (${settings.rules.acceptance ?? "efficient"} <> 'optimal' OR acceptance ? 'optimal')
        AND id::text IN (SELECT jsonb_array_elements_text(${JSON.stringify(available.map((x) => x.id))}::jsonb))`,
    )
  ).rows;
  const allowed = new Set(permitted.map((x) => x.id));
  const candidates = available.filter((x) => allowed.has(x.id));
  if (!candidates.length) throw noMatchingQuestions(settings.rules.acceptance === "optimal");
  const context =
    !settings.selectedProblemVersionId && settings.questionSelection === "recommended"
      ? await recommendationContext(tx, participants)
      : undefined;
  const ranked = context
    ? matchRecommendationCandidates(
        await learningQuestions(
          tx,
          candidates.map((item) => item.id),
        ),
        context,
        participants,
        Date.now(),
      )
    : undefined;
  const eligibleIds = new Set((ranked ?? candidates).map((item) => item.id));
  const eligible = candidates.filter((item) => eligibleIds.has(item.id));
  if (!eligible.length) throw noMatchingQuestions();
  const chosen = choice(eligible);
  const pinned = await tx.execute(
    sql`SELECT v.id FROM question_publications v JOIN problems p ON p.id=v.problem_id WHERE v.id=${chosen.id}::uuid AND v.sealed AND p.current_publication_id=v.id AND (p.owner_id IS NULL OR p.owner_id=${owner}) FOR SHARE OF p,v`,
  );
  if (!pinned.rows.length) throw noMatchingQuestions();
  const latest = await readCandidates(tx, { userId: owner }, criteria);
  if (!latest.some((item) => item.id === chosen.id)) throw noMatchingQuestions();
  const metrics = ranked?.find((row) => row.id === chosen.id);
  if (matchId && metrics)
    await tx.execute(sql`
    INSERT INTO recommendation_match_selections(match_id,model_id,mean_success,success_spread,familiarity_gap)
    VALUES(${matchId}::uuid,${context?.modelId ?? null}::uuid,${metrics.average},${metrics.spread},${metrics.imbalance})
  `);
  return chosen;
}
