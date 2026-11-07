/** @file approval.ts @description Server-only vote authorization for shared paid actions. @module factions */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import type { TeamVote } from "@quorem/contracts/factions";
import type { RuleApproval, RuleActionRequest } from "@quorem/contracts/match-rules";
import { ApplicationError } from "../../../application/error.ts";
type Action =
  | RuleActionRequest
  | { kind: "submit"; source: string; workspaceId: string; level: number };
/** No public request can supply approvedVoteId; only the majority executor passes it. */
export async function requireTeamApproval(
  tx: Transaction,
  match: string,
  actor: string,
  cost: RuleApproval,
  action: Action,
  approvedVoteId?: string,
) {
  if (!cost.seconds && !cost.points) return;
  const participant = (
    await tx.execute<{ team: number | null; id: string }>(
      sql`SELECT p.team,u.participant_id AS id FROM match_participants p JOIN users u ON u.id=p.owner_id WHERE p.match_id=${match}::uuid AND p.owner_id=${actor}`,
    )
  ).rows[0];
  if (participant?.team == null) return;
  const rejected = () =>
    new ApplicationError("vote_required", "This action requires a team vote", 409);
  if (!approvedVoteId) throw rejected();
  const vote = (
    await tx.execute<{ vote: TeamVote }>(
      sql`SELECT vote FROM team_votes WHERE id=${approvedVoteId}::uuid AND match_id=${match}::uuid AND team=${participant.team} FOR UPDATE`,
    )
  ).rows[0]?.vote;
  if (
    !vote ||
    vote.state !== "approved" ||
    !vote.electorate.includes(participant.id) ||
    vote.quote.ruleVersion !== cost.ruleVersion ||
    vote.quote.cost.seconds !== cost.seconds ||
    vote.quote.cost.points !== cost.points
  )
    throw rejected();
  const approved = vote.quote.action;
  if (action.kind === "submit") {
    if (
      approved.kind !== "submit" ||
      approved.source !== action.source ||
      approved.workspaceId !== action.workspaceId ||
      approved.level !== action.level
    )
      throw rejected();
  } else if (
    approved.kind !== "reveal" ||
    (approved.target === "case" ? "hiddenCase" : approved.target) !== action.kind ||
    approved.submissionId !== action.submissionId ||
    approved.caseIndex !== action.caseIndex
  )
    throw rejected();
  await tx.execute(
    sql`UPDATE team_votes SET vote=jsonb_set(vote,'{state}','"executed"'::jsonb) WHERE id=${approvedVoteId}::uuid`,
  );
}
