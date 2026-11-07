import { requireTeamApproval } from "../../factions/approval.ts";
/** @file actions.ts @description Exact-cost assistance authorization and execution. @module matches */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import {
  assistanceCost,
  type MatchRuleSettings,
  type RuleActionRequest,
  type RuleActionResult,
  type RuleApproval,
} from "@quorem/contracts/match-rules";
import { ApplicationError } from "../../../../application/error.ts";
import { fingerprint } from "../lifecycle/crypto.ts";
import {
  approachesProjection,
  canonicalApproachProjection,
} from "../../problems/editorial-storage.ts";
import { competitiveSubject, recordRuleEvent, submissionPolicy } from "./ledger.ts";

export function assertRuleApproval(actual: RuleApproval, approved?: RuleApproval) {
  if (
    !approved ||
    approved.ruleVersion !== actual.ruleVersion ||
    approved.seconds !== actual.seconds ||
    approved.points !== actual.points
  )
    throw new ApplicationError(
      "rule_cost_changed",
      "Review the current action cost before continuing",
      409,
    );
}
/** Caller locks match and verifies current active membership; private data never leaves a quote. */
export async function prepareRuleAction(
  tx: Transaction,
  match: string,
  actor: string,
  rules: MatchRuleSettings,
  input: RuleActionRequest,
) {
  const subject = await competitiveSubject(tx, match, actor);
  const ruleVersion = await fingerprint(rules);
  const policy = await submissionPolicy(tx, match, subject, rules);
  if (input.kind === "submission")
    return {
      subject,
      resource: "",
      quote: {
        kind: input.kind,
        ruleVersion,
        seconds: policy.seconds,
        points: policy.points,
        cooldownSeconds: policy.remaining,
        alreadyRevealed: false,
      },
      revealed: undefined,
    };
  if (rules.assistance[input.kind].access === "blocked")
    throw new ApplicationError("forbidden", "This assistance is disabled", 403);
  let resource = input.kind as string;
  let caseIndex: number | undefined;
  let revealed: NonNullable<RuleActionResult["revealed"]>;
  if (input.kind === "hiddenCase") {
    const row = (
      await tx.execute<{
        resource: string;
        ordinal: number;
        input: string | null;
        result: string | null;
      }>(sql`
      SELECT c.ordinal,encode(c.blob_hash,'hex') AS resource,
        CASE WHEN octet_length(b.data)<=5242880 THEN convert_from(b.data,'UTF8') END AS input,
        CASE WHEN octet_length(r.result_data)<=5242880 THEN convert_from(r.result_data,'UTF8') END AS result
      FROM submissions s JOIN match_participants p ON p.match_id=s.match_id AND p.owner_id=s.owner_id
      JOIN execution_jobs j ON j.submission_id=s.id
      JOIN runner_job_inputs i ON i.job_id=j.id AND i.sealed
      JOIN runner_job_input_cases c ON c.job_id=j.id AND ( ${input.caseIndex ?? null}::int IS NULL OR c.ordinal=${input.caseIndex ?? null}::int) AND c.channel='private'
      JOIN runner_input_blobs b ON b.hash=c.blob_hash
      JOIN execution_verified_cases v ON v.job_id=j.id AND v.ordinal=c.ordinal AND v.attempt_id=j.attempt_id AND v.sandbox_scope=j.sandbox_scope
      JOIN match_private_result_cases r ON r.submission_id=s.id AND r.ordinal=c.ordinal
      WHERE s.id=${input.submissionId!}::uuid AND s.match_id=${match}::uuid AND COALESCE(p.competitor_id,p.owner_id)=${subject}
        AND s.kind='submit' AND s.state='completed'
      ORDER BY EXISTS(SELECT 1 FROM match_rule_events granted WHERE granted.match_id=s.match_id AND granted.competitor_id=${subject} AND granted.kind='hiddenCase' AND granted.resource_key=encode(c.blob_hash,'hex')),c.ordinal LIMIT 1
    `)
    ).rows[0];
    if (!row) throw new ApplicationError("not_found", "Hidden case unavailable", 404);
    if (row.input === null || row.result === null)
      throw new ApplicationError("payload_too_large", "This case is too large to reveal", 413);
    resource = row.resource;
    caseIndex = row.ordinal;
    revealed = { input: row.input, result: row.result };
  } else if (input.kind === "topics") {
    const rows = (
      await tx.execute<{ tag: string }>(
        sql`SELECT t.tag FROM problem_tags t JOIN matches m ON m.problem_version_id=t.version_id WHERE m.id=${match}::uuid ORDER BY t.ordinal`,
      )
    ).rows;
    if (!rows.length) throw new ApplicationError("not_found", "No topics available", 404);
    revealed = { topics: rows.map((r) => r.tag) };
  } else {
    const row = (
      await tx.execute<{ data: string }>(
        sql`SELECT jsonb_build_object('canonicalApproachId',${canonicalApproachProjection(sql`m.problem_version_id`)},'items',${approachesProjection(sql`m.problem_version_id`, false)})::text AS data FROM matches m JOIN problem_versions v ON v.id=m.problem_version_id WHERE m.id=${match}::uuid AND v.odyssey IS NULL AND EXISTS(SELECT 1 FROM problem_solution_approaches a WHERE a.version_id=v.id AND btrim(a.time_complexity)<>'' AND btrim(a.space_complexity)<>'')`,
      )
    ).rows[0];
    if (!row) throw new ApplicationError("not_found", "No complexity available", 404);
    revealed = { complexity: row.data };
  }
  const alreadyRevealed =
    (
      await tx.execute(
        sql`SELECT 1 FROM match_rule_events WHERE match_id=${match}::uuid AND competitor_id=${subject} AND kind=${input.kind} AND resource_key=${resource}`,
      )
    ).rows.length > 0;
  return {
    subject,
    resource,
    revealed,
    quote: {
      ...(caseIndex !== undefined ? { caseIndex } : {}),
      kind: input.kind,
      ruleVersion,
      ...(alreadyRevealed ? { seconds: 0, points: 0 } : assistanceCost(rules, input.kind)),
      cooldownSeconds: 0,
      alreadyRevealed,
    },
  };
}
/** Recompute this plan in the execution transaction; a stale vote/confirmation cannot raise its price. */
export async function executeRuleAction(
  tx: Transaction,
  match: string,
  actor: string,
  rules: MatchRuleSettings,
  input: RuleActionRequest,
  approvedTeamVoteId?: string,
): Promise<RuleActionResult> {
  const plan = await prepareRuleAction(tx, match, actor, rules, input);
  if (!input.approval || input.kind === "submission") return { quote: plan.quote };
  if (input.kind === "hiddenCase" && input.caseIndex === undefined)
    throw new ApplicationError("invalid_input", "Confirm the selected case", 400);
  assertRuleApproval(plan.quote, input.approval);
  await requireTeamApproval(tx, match, actor, plan.quote, input, approvedTeamVoteId);
  if (!plan.quote.alreadyRevealed)
    await recordRuleEvent(tx, {
      match,
      actor,
      subject: plan.subject,
      kind: input.kind,
      resource: plan.resource,
      action: plan.quote.seconds || plan.quote.points ? "penalty" : "announce",
      cost: plan.quote,
    });
  return { quote: plan.quote, revealed: plan.revealed };
}
