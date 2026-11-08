/** @file repository.ts @description Atomic PostgreSQL match reconciliation. @module matches */
import type { MatchRuleSettings } from "@quorem/contracts/match-rules";
import { effectiveEvent, matchSubmissionDeadline } from "../rules/ledger.ts";
import { reviewPending } from "../review/pending.ts";
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type { SubmissionProgress } from "../../../../modules/matches/model.ts";
import { reconcile } from "../../../../modules/matches/reconcile.ts";
import { verifiedMatchProgress } from "../../judging/worker/verified-progress.ts";
type MatchRow = {
  id: string;
  state: string;
  started: boolean;
  expired: boolean;
  deadline: string | null;
  submissionDeadline: string | null;
  finalizing: string | null;
  now: string;
  outcome: unknown;
  rules: MatchRuleSettings;
};
type Person = {
  owner: string;
  subject: string;
  state: string;
  best: number;
  points: number;
  percentage: number;
};
type Submission = {
  admittedAt: string;
  owner: string;
  state: string;
  job: string | null;
  intermediate: boolean | null;
};
const timestamp = (expr: ReturnType<typeof sql>) =>
  sql`floor(extract(epoch FROM ${expr})*1000000)::bigint::text`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Caller owns the transaction; admission locks owner first, then this match. */
export async function reconcileMatch(
  tx: Transaction,
  id: string,
  { publishUpdate = false } = {},
): Promise<void> {
  if (!uuid.test(id)) throw new ApplicationError("not_found", "Match not found", 404);
  // Sample only after the aggregate lock, including after a long lock wait.
  const locked = await tx.execute(sql`SELECT id FROM matches WHERE id=${id}::uuid FOR UPDATE`);
  if (!locked.rows.length) throw new ApplicationError("not_found", "Match not found", 404);
  const match = (
    await tx.execute<MatchRow>(
      sql`WITH sampled AS MATERIALIZED (SELECT clock_timestamp() AS now) SELECT m.id::text,m.state,m.started_at IS NOT NULL AS started,m.expires_at<=sampled.now AS expired,${timestamp(sql`m.deadline`)} AS deadline,${timestamp(matchSubmissionDeadline(sql`m`))} AS "submissionDeadline",${timestamp(sql`m.finalizing_at`)} AS finalizing,${timestamp(sql`sampled.now`)} AS now,m.outcome,m.rules FROM matches m,sampled WHERE m.id=${id}::uuid`,
    )
  ).rows[0];
  if (!match || match.outcome !== null) return;
  if (!match.started) {
    if (match.expired) {
      await finishMatch(tx, id, "cancelled", null, "invite_expired");
      await matchEvent(tx, id, "match.completed");
    }
    return;
  }
  if (match.deadline === null) throw new Error("Started match has no deadline");
  const people = (
    await tx.execute<Person>(
      sql`SELECT p.owner_id AS owner,COALESCE(p.competitor_id,p.owner_id) AS subject,COALESCE(p.submission_state,'') AS state,p.best_passed AS best,p.best_percentage AS percentage,COALESCE((SELECT sum(e.points) FROM match_rule_events e WHERE e.match_id=p.match_id AND e.competitor_id=COALESCE(p.competitor_id,p.owner_id) AND ${effectiveEvent(sql`e`)}),0)::int AS points FROM match_participants p WHERE p.match_id=${id}::uuid AND NOT p.forfeited`,
    )
  ).rows;
  const rows = (
    await tx.execute<Submission>(
      sql`SELECT COALESCE(mp.competitor_id,s.owner_id) AS owner,${timestamp(sql`s.admitted_at`)} AS "admittedAt",s.state,j.id::text AS job,CASE WHEN p.odyssey IS NULL AND s.odyssey_level IS NULL THEN false WHEN jsonb_typeof(p.odyssey->'levels')='array' AND s.odyssey_level BETWEEN 1 AND jsonb_array_length(p.odyssey->'levels') THEN s.odyssey_level < jsonb_array_length(p.odyssey->'levels') END AS intermediate FROM submissions s JOIN match_participants mp ON mp.match_id=s.match_id AND mp.owner_id=s.owner_id JOIN workspaces w ON w.id=s.workspace_id JOIN problem_versions p ON p.id=w.problem_version_id LEFT JOIN execution_jobs j ON j.submission_id=s.id WHERE s.match_id=${id}::uuid AND s.kind='submit' ORDER BY s.admitted_at,s.match_sequence`,
    )
  ).rows;
  const submissions: SubmissionProgress[] = [];
  for (const row of rows) {
    const evidence =
      row.job && row.intermediate !== null
        ? await verifiedMatchProgress(tx, row.job)
        : { kind: "unavailable" as const };
    const verified =
      evidence.kind === "verified" &&
      Number.isSafeInteger(evidence.caseCount) &&
      evidence.caseCount > 0 &&
      Number.isSafeInteger(evidence.definiteFailures) &&
      evidence.definiteFailures >= 0 &&
      evidence.definiteFailures <= evidence.caseCount
        ? evidence
        : null;
    const terminal =
      row.state === "completed" &&
      verified?.terminal &&
      Number.isSafeInteger(verified.terminal.passed) &&
      verified.terminal.passed >= 0 &&
      verified.terminal.passed + verified.definiteFailures === verified.caseCount &&
      (verified.terminal.verdict === "accepted") === (verified.definiteFailures === 0)
        ? verified.terminal
        : null;
    const max =
      verified && verified.definiteFailures > 0
        ? verified.caseCount - verified.definiteFailures
        : null;
    submissions.push({
      owner: row.owner,
      admittedAt: BigInt(row.admittedAt),
      state: row.state,
      verdict: terminal?.verdict ?? "",
      score: terminal && verified ? { passed: terminal.passed, total: verified.caseCount } : null,
      intermediate: row.intermediate ?? false,
      maxPossible: max,
      cannotPass: max !== null,
    });
  }
  const decision = reconcile(
    BigInt(match.now),
    BigInt(match.deadline),
    match.finalizing === null ? null : BigInt(match.finalizing),
    [...new Set(people.map((p) => p.subject))],
    submissions,
    {
      victory: match.rules.victory,
      penalties: new Map(people.map((p) => [p.subject, p.points])),
      submissionDeadline: BigInt(match.submissionDeadline ?? match.deadline),
    },
  );
  let changed = false;
  for (const p of people) {
    const next = decision.progress.get(p.subject)!;
    if (
      p.state !== next.state ||
      p.best !== next.bestPassed ||
      p.percentage !== next.bestPercentage
    ) {
      await tx.execute(
        sql`UPDATE match_participants SET best_percentage=${next.bestPercentage},best_passed=${next.bestPassed},submission_state=NULLIF(${next.state},'') WHERE match_id=${id}::uuid AND owner_id=${p.owner}`,
      );
      changed = true;
    }
  }
  if (match.finalizing === null && decision.finalizingAt !== null) {
    await tx.execute(
      sql`UPDATE matches SET state='finalizing',finalizing_at=to_timestamp(${decision.finalizingAt.toString()}::numeric/1000000) WHERE id=${id}::uuid`,
    );
    changed = true;
  }
  if (decision.outcome) {
    await finishMatch(
      tx,
      id,
      decision.outcome.kind,
      decision.outcome.winnerUserId?.startsWith("team:")
        ? decision.outcome.winnerUserId
        : (people.find((p) => p.subject === decision.outcome?.winnerUserId)?.owner ?? null),
      decision.outcome.reason,
    );
    changed = true;
  }
  if (changed || publishUpdate)
    await matchEvent(tx, id, decision.outcome ? "match.completed" : "match.updated");
}
/** Caller holds the match lock and emits the versioned notice. */
export async function finishMatch(
  tx: Transaction,
  id: string,
  kind: string,
  winner: string | null,
  reason: string,
): Promise<void> {
  const winnerTeam = winner && /^team:[1-4]$/.test(winner) ? Number(winner.slice(5)) : null;
  const result = await tx.execute(
    sql`UPDATE matches SET state=${kind === "cancelled" ? "cancelled" : "completed"},completed_at=clock_timestamp(),outcome=jsonb_strip_nulls(jsonb_build_object('kind',${kind}::text,'winnerUserId',(SELECT participant_id FROM users WHERE id=${winner}),'winnerTeam',${winnerTeam}::int,'reason',${reason}::text,'completedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) WHERE id=${id}::uuid RETURNING id`,
  );
  if (result.rows.length !== 1) throw new Error("Match finish failed");
  if (
    winner !== null &&
    !(
      await tx.execute(
        winnerTeam === null
          ? sql`SELECT 1 FROM users WHERE id=${winner}`
          : sql`SELECT 1 FROM match_participants WHERE match_id=${id}::uuid AND team=${winnerTeam}`,
      )
    ).rows.length
  )
    throw new Error("Match winner missing");
  await tx.execute(
    sql`UPDATE guest_sessions SET expires_at=LEAST(expires_at,clock_timestamp()+interval '2 hours') WHERE match_id=${id}::uuid`,
  );
  await tx.execute(sql`DELETE FROM match_reservations WHERE match_id=${id}::uuid`);
}
/** Caller holds the match lock; increments the aggregate version once. */
export async function matchEvent(
  tx: Transaction,
  id: string,
  type: "match.updated" | "match.completed",
): Promise<void> {
  const row = (
    await tx.execute<{ version: string }>(
      sql`UPDATE matches SET version=version+1 WHERE id=${id}::uuid RETURNING version::text`,
    )
  ).rows[0];
  if (!row) throw new Error("Match disappeared");
  await tx.execute(
    sql`INSERT INTO match_outbox(id,match_id,version,event_type) VALUES(${crypto.randomUUID()}::uuid,${id}::uuid,${row.version}::bigint,${type})`,
  );
}
/** Fenced scheduler acknowledgement never clears a successor generation. */
export async function reconcileScheduledMatch(
  tx: Transaction,
  id: string,
  generation: string | null,
): Promise<void> {
  if (!uuid.test(id)) return;
  const locked = await tx.execute(sql`SELECT id FROM matches WHERE id=${id}::uuid FOR UPDATE`);
  if (!locked.rows.length) return;
  // A submission transition can settle or refund a charge without changing standings.
  await reconcileMatch(tx, id, { publishUpdate: generation !== null });
  await tx.execute(sql`UPDATE matches SET reconciled_at=clock_timestamp() WHERE id=${id}::uuid`);
  if (generation !== null) {
    if (!/^\d+$/.test(generation)) throw new Error("Invalid reconciliation generation");
    const settled =
      await tx.execute(sql`SELECT 1 FROM matches m JOIN match_reconciliation_pending p ON p.match_id=m.id
      WHERE m.id=${id}::uuid AND p.generation=${generation}::bigint AND m.state IN ('completed','cancelled')
        AND NOT (${reviewPending(sql`m.id`)})`);
    if (settled.rows.length) await matchEvent(tx, id, "match.updated");
    await tx.execute(
      sql`DELETE FROM match_reconciliation_pending WHERE match_id=${id}::uuid AND generation=${generation}::bigint`,
    );
  }
}
