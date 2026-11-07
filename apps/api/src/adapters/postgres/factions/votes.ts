/** @file votes.ts @description Team-majority authorization and exactly-once action execution. @module factions */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { factionLimits, type TeamActionQuote, type TeamVote } from "@quorem/contracts/factions";
import type { Principal } from "../../../modules/identity/model.ts";
import {
  castVote,
  cancelVote,
  proposeVote,
  resolveVote,
} from "../../../modules/factions/policy.ts";
import { ApplicationError } from "../../../application/error.ts";
import type { TeamAccess } from "./access.ts";
export interface TeamActionExecutor {
  quote(
    tx: Transaction,
    actor: Principal,
    id: string,
    team: TeamAccess,
    input: unknown,
  ): Promise<TeamActionQuote>;
  execute(
    tx: Transaction,
    actor: Principal,
    id: string,
    team: TeamAccess,
    vote: TeamVote,
  ): Promise<void>;
}
export async function teamVoteCommand(
  tx: Transaction,
  actor: Principal,
  id: string,
  team: TeamAccess,
  action: string,
  body: Record<string, unknown>,
  executor: TeamActionExecutor,
) {
  let vote: TeamVote;
  if (action === "propose") {
    const recent = (
      await tx.execute<{ vote: TeamVote }>(
        sql`SELECT vote FROM team_votes WHERE match_id=${id}::uuid AND team=${team.team} ORDER BY created_at DESC LIMIT 1`,
      )
    ).rows[0]?.vote;
    if (recent) {
      const state = resolveVote(recent, team.now).state;
      if (state === "pending" || state === "approved")
        throw new ApplicationError(
          "invalid_transition",
          "Resolve the current team vote first",
          409,
        );
      if (
        (state === "rejected" || state === "cancelled" || state === "expired") &&
        team.now < (recent.resolvedAt ?? recent.expiresAt) + factionLimits.retryDelayMs
      )
        throw new ApplicationError("rate_limited", "Wait before proposing another action", 429);
    }
    const electorate = (
      await tx.execute<{ id: string }>(
        sql`SELECT u.participant_id AS id FROM match_participants p JOIN users u ON u.id=p.owner_id WHERE p.match_id=${id}::uuid AND p.team=${team.team} ORDER BY p.seat`,
      )
    ).rows.map((r) => r.id);
    const quote = await executor.quote(tx, actor, id, team, body.action);
    vote = proposeVote(crypto.randomUUID(), team.participantId, electorate, quote, team.now);
  } else {
    if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id))
      throw new ApplicationError("invalid_input", "Invalid vote", 400);
    const saved = (
      await tx.execute<{ vote: TeamVote }>(
        sql`SELECT vote FROM team_votes WHERE id=${body.id}::uuid AND match_id=${id}::uuid AND team=${team.team} FOR UPDATE`,
      )
    ).rows[0];
    if (!saved) throw new ApplicationError("not_found", "Vote unavailable", 404);
    if (action === "vote" && typeof body.approve === "boolean")
      vote = castVote(saved.vote, team.participantId, body.approve, team.now);
    else if (action === "cancel") vote = cancelVote(saved.vote, team.participantId, team.now);
    else throw new ApplicationError("invalid_input", "Invalid ballot", 400);
  }
  if (vote.state === "approved") {
    await tx.execute(
      sql`INSERT INTO team_votes(id,match_id,team,vote) VALUES(${vote.id}::uuid,${id}::uuid,${team.team},${JSON.stringify(vote)}::jsonb) ON CONFLICT(id) DO UPDATE SET vote=excluded.vote`,
    );
    // The executor rechecks the frozen quote under the same aggregate lock.
    await executor.execute(tx, actor, id, team, vote);
    vote = { ...vote, state: "executed" };
  }
  await tx.execute(
    sql`INSERT INTO team_votes(id,match_id,team,vote) VALUES(${vote.id}::uuid,${id}::uuid,${team.team},${JSON.stringify(vote)}::jsonb) ON CONFLICT(id) DO UPDATE SET vote=excluded.vote`,
  );
  return vote;
}
