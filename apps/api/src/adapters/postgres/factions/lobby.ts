/** @file lobby.ts @description Party team assignment under the existing party lock. @module factions */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import type { Principal } from "../../../modules/identity/model.ts";
import type { TeamLobby, TeamAssignment } from "@quorem/contracts/factions";
import { balanceTeams, validateTeamCount } from "../../../modules/factions/policy.ts";
import { ApplicationError } from "../../../application/error.ts";
import { lockParty, reset } from "../parties/store.ts";
export async function teamLobby(tx: Transaction, id: string): Promise<TeamLobby> {
  const row = (
    await tx.execute<{ teamCount: number }>(
      sql`SELECT team_count AS "teamCount" FROM parties WHERE id=${id}::uuid`,
    )
  ).rows[0];
  const assignments = (
    await tx.execute<TeamAssignment>(
      sql`SELECT u.participant_id AS "userId",pm.team FROM party_members pm JOIN users u ON u.id=pm.owner_id WHERE pm.party_id=${id}::uuid ORDER BY pm.seat`,
    )
  ).rows;
  return { teamCount: row.teamCount, assignments };
}
export async function organizeTeams(
  tx: Transaction,
  actor: Principal,
  id: string,
  body: Record<string, unknown>,
) {
  const party = await lockParty(tx, id, actor.userId);
  if (party.current || party.settings.mode !== "factions")
    throw new ApplicationError(
      "invalid_transition",
      "Teams can only change in a Factions lobby",
      409,
    );
  const current = await teamLobby(tx, id);
  const me = (
    await tx.execute<{ id: string }>(
      sql`SELECT participant_id AS id FROM users WHERE id=${actor.userId}`,
    )
  ).rows[0].id;
  let assignments = current.assignments;
  let count = current.teamCount;
  if (body.action === "balance" || body.action === "count") {
    if (party.host !== actor.userId)
      throw new ApplicationError("forbidden", "Only the host can organize all teams", 403);
    if (body.action === "count") {
      if (typeof body.count !== "number")
        throw new ApplicationError("invalid_input", "Invalid team count", 400);
      count = body.count;
      validateTeamCount(count);
      assignments = assignments.map((m) => ({
        ...m,
        team: m.team !== null && m.team > count ? null : m.team,
      }));
    } else assignments = balanceTeams(assignments, count);
  } else if (body.action === "assign") {
    if (body.userId !== me && party.host !== actor.userId)
      throw new ApplicationError("forbidden", "Choose your own team", 403);
    const team = body.team;
    if (
      team !== null &&
      (typeof team !== "number" || !Number.isInteger(team) || team < 1 || team > count)
    )
      throw new ApplicationError("invalid_input", "Invalid team", 400);
    if (!assignments.some((m) => m.userId === body.userId))
      throw new ApplicationError("not_found", "Player unavailable", 404);
    assignments = assignments.map((m) =>
      m.userId === body.userId ? { ...m, team: team as number | null } : m,
    );
  } else throw new ApplicationError("invalid_input", "Invalid team action", 400);
  if (
    count === current.teamCount &&
    JSON.stringify(assignments) === JSON.stringify(current.assignments)
  )
    return current;
  await tx.execute(sql`UPDATE parties SET team_count=${count} WHERE id=${id}::uuid`);
  for (const member of assignments)
    await tx.execute(
      sql`UPDATE party_members SET team=${member.team} WHERE party_id=${id}::uuid AND owner_id=(SELECT id FROM users WHERE participant_id=${member.userId})`,
    );
  await reset(tx, id);
  return teamLobby(tx, id);
}
