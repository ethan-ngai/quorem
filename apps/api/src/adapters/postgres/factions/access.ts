/** @file access.ts @description Team authority beneath match membership and guest access. @module factions */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import type { Principal } from "../../../modules/identity/model.ts";
import { lockMatch, requireMatchMember } from "../matches/lifecycle/repository.ts";
import { ApplicationError } from "../../../application/error.ts";
export async function lockTeam(tx: Transaction, actor: Principal, id: string, active = false) {
  const match = await lockMatch(tx, id);
  await requireMatchMember(tx, actor, id);
  const row = (
    await tx.execute<{
      team: number;
      workspaceId: string;
      language: string;
      source: string;
      epoch: string;
      version: string;
      now: string;
      active: boolean;
      participantId: string;
    }>(sql`
    SELECT t.team,t.workspace_id::text AS "workspaceId",w.language,t.source,t.document_epoch::text AS epoch,t.document_version::text AS version,
      floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text AS now,
      m.state='active' AND m.deadline>clock_timestamp() AND NOT p.forfeited AS active,u.participant_id AS "participantId"
    FROM match_participants p JOIN match_teams t ON t.match_id=p.match_id AND t.team=p.team
    JOIN matches m ON m.id=p.match_id JOIN workspaces w ON w.id=t.workspace_id JOIN users u ON u.id=p.owner_id
    WHERE p.match_id=${id}::uuid AND p.owner_id=${actor.userId} FOR UPDATE OF t`)
  ).rows[0];
  if (match.mode !== "factions" || !row)
    throw new ApplicationError("not_found", "Team unavailable", 404);
  if (active && !row.active)
    throw new ApplicationError("invalid_transition", "Team actions are closed", 409);
  return {
    ...row,
    now: Number(row.now),
    version: Number(row.version),
    rules: match.settings.rules,
  };
}
export type TeamAccess = Awaited<ReturnType<typeof lockTeam>>;
