/** @file ledger.ts @description Competitive-subject penalty accounting under the match lock. @module matches */
import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import type { MatchRuleSettings } from "@quorem/contracts/match-rules";
import { ApplicationError } from "../../../../application/error.ts";

export const effectiveEvent = (alias: SQL) =>
  sql`(${alias}.submission_id IS NULL OR NOT EXISTS(SELECT 1 FROM submissions failed WHERE failed.id=${alias}.submission_id AND failed.state='failed'))`;

/** @returns The latest cutoff guaranteed to survive any refunds for pending submissions. */
export function matchSubmissionDeadline(match: SQL) {
  return sql`CASE WHEN ${match}.rules->>'victory'='race' AND ${match}.started_at IS NOT NULL THEN
    LEAST(${match}.deadline, GREATEST(${match}.started_at, ${match}.deadline - make_interval(secs => COALESCE((
      SELECT min(COALESCE((
        SELECT sum(e.seconds) FROM match_rule_events e
        WHERE e.match_id=${match}.id AND e.competitor_id=subjects.id AND e.seconds>0
          AND NOT EXISTS(
            SELECT 1 FROM submissions s WHERE s.id=e.submission_id AND s.state IN ('queued','running','failed')
          )
      ),0))
      FROM (
        SELECT DISTINCT COALESCE(p.competitor_id,p.owner_id) AS id
        FROM match_participants p WHERE p.match_id=${match}.id AND NOT p.forfeited
      ) subjects
    ),0)::double precision))) ELSE ${match}.deadline END`;
}

/** Caller holds the match lock. Submission admission supplies its persisted timestamp. */
export async function requireSubmissionTime(
  tx: Transaction,
  match: string,
  subject: string,
  additionalSeconds: number,
  admittedAt?: string,
) {
  const [window] = (
    await tx.execute<{ open: boolean }>(sql`
      SELECT COALESCE(${admittedAt ?? null}::timestamptz, clock_timestamp()) + make_interval(secs => ${additionalSeconds} + COALESCE((
        SELECT sum(e.seconds) FROM match_rule_events e
        WHERE e.match_id=m.id AND e.competitor_id=${subject} AND e.seconds>0 AND ${effectiveEvent(sql`e`)}
      ),0)::double precision) < m.deadline AS open
      FROM matches m WHERE m.id=${match}::uuid
    `)
  ).rows;
  if (!window?.open)
    throw new ApplicationError(
      "invalid_transition",
      additionalSeconds > 0
        ? "The time penalty must be less than your remaining submission time"
        : "Your submission time has ended",
      409,
    );
}
export async function competitiveSubject(tx: Transaction, match: string, actor: string) {
  const row = (
    await tx.execute<{ subject: string }>(
      sql`SELECT COALESCE(competitor_id,owner_id) AS subject FROM match_participants WHERE match_id=${match}::uuid AND owner_id=${actor} AND NOT forfeited`,
    )
  ).rows[0];
  if (!row) throw new ApplicationError("forbidden", "Active match membership required", 403);
  return row.subject;
}
export interface RuleCost {
  seconds: number;
  points: number;
}
export function victoryCost(rules: MatchRuleSettings, seconds: number, points: number): RuleCost {
  return {
    seconds: rules.victory === "race" ? seconds : 0,
    points: rules.victory === "high_score" ? points : 0,
  };
}
/** Caller holds the aggregate lock; submission failures cease contributing automatically. */
export async function submissionPolicy(
  tx: Transaction,
  match: string,
  subject: string,
  rules: MatchRuleSettings,
) {
  const row = (
    await tx.execute<{ count: number; remaining: number }>(
      sql`SELECT count(*)::int AS count,GREATEST(0,ceil(extract(epoch FROM max(e.occurred_at)+make_interval(secs=>${rules.submissions.cooldownSeconds})-clock_timestamp())))::int AS remaining FROM match_rule_events e WHERE e.match_id=${match}::uuid AND e.competitor_id=${subject} AND e.kind='submission' AND ${effectiveEvent(sql`e`)}`,
    )
  ).rows[0];
  const allowance = rules.submissions.freeSubmissions;
  const penalized = allowance !== null && row.count >= allowance;
  return {
    count: row.count,
    remaining: row.remaining ?? 0,
    ...victoryCost(
      rules,
      penalized ? rules.submissions.seconds : 0,
      penalized ? rules.submissions.points : 0,
    ),
  };
}
export async function recordRuleEvent(
  tx: Transaction,
  input: {
    match: string;
    actor: string;
    subject: string;
    kind: string;
    action: string;
    cost: RuleCost;
    resource?: string;
    submission?: string;
  },
) {
  await tx.execute(
    sql`INSERT INTO match_rule_events(id,match_id,owner_id,competitor_id,kind,action,seconds,points,resource_key,submission_id) VALUES(${crypto.randomUUID()}::uuid,${input.match}::uuid,${input.actor},${input.subject},${input.kind},${input.action},${input.cost.seconds},${input.cost.points},${input.resource ?? null},${input.submission ?? null}::uuid)`,
  );
}
