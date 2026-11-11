/** @file start.ts @description Freeze lobby teams and initialize one workspace per team. @module factions */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { requireReadyTeams } from "../../../modules/factions/policy.ts";
import { teamLobby } from "./lobby.ts";
import { projectAuthorizedPublication } from "../problems/queries/repository.ts";
import { projectQuestionRuntime } from "../problems/runtime.ts";
import { parseLosslessJson, type JsonValue } from "@quorem/questions";
export async function freezePartyTeams(tx: Transaction, partyId: string, matchId: string) {
  const lobby = await teamLobby(tx, partyId);
  requireReadyTeams(lobby.assignments, lobby.teamCount);
  await tx.execute(
    sql`UPDATE matches SET faction_names=${JSON.stringify(lobby.names)}::jsonb WHERE id=${matchId}::uuid`,
  );
  await tx.execute(
    sql`UPDATE match_participants p SET team=pm.team,competitor_id='team:'||pm.team::text FROM party_members pm WHERE p.match_id=${matchId}::uuid AND pm.party_id=${partyId}::uuid AND pm.owner_id=p.owner_id`,
  );
}
/** Called after ordinary workspace creation; no documents are visible before transaction commit. */
export async function initializeTeamWorkspaces(tx: Transaction, id: string) {
  const members = (
    await tx.execute<{ team: number; workspace: string; version: string; language: string }>(
      sql`SELECT p.team,p.workspace_id::text AS workspace,w.publication_id::text AS version,w.language FROM match_participants p JOIN workspaces w ON w.id=p.workspace_id WHERE p.match_id=${id}::uuid ORDER BY p.seat`,
    )
  ).rows;
  const teams = new Map<number, string>();
  for (const member of members) {
    const existing = teams.get(member.team);
    if (existing) {
      await tx.execute(
        sql`UPDATE match_participants SET workspace_id=${existing}::uuid WHERE match_id=${id}::uuid AND workspace_id=${member.workspace}::uuid`,
      );
      await tx.execute(sql`DELETE FROM workspaces WHERE id=${member.workspace}::uuid`);
      continue;
    }
    await tx.execute(
      sql`UPDATE workspaces SET team=${member.team} WHERE id=${member.workspace}::uuid`,
    );
    const raw = await projectAuthorizedPublication(tx, member.version);
    if (!raw) throw new Error("Team question unavailable");
    const problem = parseLosslessJson(raw) as { [key: string]: JsonValue };
    projectQuestionRuntime(problem, member.language);
    await tx.execute(
      sql`INSERT INTO match_teams(match_id,team,workspace_id,source) VALUES(${id}::uuid,${member.team},${member.workspace}::uuid,${problem.starterSource as string})`,
    );
    teams.set(member.team, member.workspace);
  }
}
