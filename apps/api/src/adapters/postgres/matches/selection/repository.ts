/** @file repository.ts @description Authorized match problem selection. @module matches */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type { Settings } from "../../../../modules/matches/lifecycle/model.ts";
import type { CandidateCriteria } from "../../../../modules/problems/model.ts";
import { readCandidates } from "../../problems/queries/repository.ts";
export async function validateSelectedMatchProblem(tx: Transaction, owner: string, s: Settings) {
  if (!s.selectedProblemVersionId) return;
  if (
    !(
      await tx.execute(
        sql`SELECT 1 FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id::text=${s.selectedProblemVersionId} AND p.current_version_id=v.id AND v.sealed AND (p.owner_id IS NULL OR p.owner_id=${owner})`,
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
export async function selectMatchCandidate(tx: Transaction, owner: string, settings: Settings) {
  await validateSelectedMatchProblem(tx, owner, settings);
  const f = settings.questionFilters;
  const criteria: CandidateCriteria = {
    selectedVersionId: settings.selectedProblemVersionId,
    difficulty: settings.difficulties.join(","),
    type: (f.type ?? "") as "" | "classic" | "odyssey",
    sql: f.sql === "true" ? "true" : "false",
    topic: f.topic ?? "",
    company: f.company ?? "",
  };
  const available = await readCandidates(tx, { userId: owner }, criteria);
  const permitted = (
    await tx.execute<{ id: string }>(
      sql`SELECT id::text AS id FROM problem_versions WHERE sealed AND id::text IN (SELECT jsonb_array_elements_text(${JSON.stringify(available.map((x) => x.id))}::jsonb))`,
    )
  ).rows;
  const allowed = new Set(permitted.map((x) => x.id));
  const candidates = available.filter((x) => allowed.has(x.id));
  if (!candidates.length)
    throw new ApplicationError(
      "no_matching_questions",
      "No questions match the selected filters",
      409,
    );
  const chosen = choice(candidates);
  const pinned = await tx.execute(
    sql`SELECT v.id FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id=${chosen.id}::uuid AND v.sealed AND p.current_version_id=v.id AND (p.owner_id IS NULL OR p.owner_id=${owner}) FOR SHARE OF p,v`,
  );
  if (!pinned.rows.length)
    throw new ApplicationError(
      "no_matching_questions",
      "No questions match the selected filters",
      409,
    );
  const latest = await readCandidates(tx, { userId: owner }, criteria);
  if (!latest.some((item) => item.id === chosen.id))
    throw new ApplicationError(
      "no_matching_questions",
      "No questions match the selected filters",
      409,
    );
  return chosen;
}
