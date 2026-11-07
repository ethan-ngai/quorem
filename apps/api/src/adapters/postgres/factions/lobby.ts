import { factionName, factionNameSchema } from "@quorem/contracts/factions";
/** @file lobby.ts @description Party team assignment under the existing party lock. @module factions */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import type { Principal } from "../../../modules/identity/model.ts";
import type { TeamLobby, TeamAssignment } from "@quorem/contracts/factions";
import { balanceTeams, validateTeamCount } from "../../../modules/factions/policy.ts";
import { ApplicationError } from "../../../application/error.ts";
import { lockParty, reset } from "../parties/store.ts";
export async function teamLobby(
  tx: Transaction,
  id: string,
): Promise<TeamLobby & { names: string[] }> {
  const row = (
    await tx.execute<{ teamCount: number; names: string[] }>(
      sql`SELECT team_count AS "teamCount",faction_names AS names FROM parties WHERE id=${id}::uuid`,
    )
  ).rows[0];
  let assignments = (
    await tx.execute<TeamAssignment>(
      sql`SELECT u.participant_id AS "userId",pm.team FROM party_members pm JOIN users u ON u.id=pm.owner_id WHERE pm.party_id=${id}::uuid ORDER BY pm.seat`,
    )
  ).rows;
  if (
    assignments.some(
      (member) => member.team === null || member.team < 1 || member.team > row.teamCount,
    )
  ) {
    assignments = balanceTeams(assignments, row.teamCount);
    for (const member of assignments)
      await tx.execute(
        sql`UPDATE party_members SET team=${member.team} WHERE party_id=${id}::uuid AND owner_id=(SELECT id FROM users WHERE participant_id=${member.userId})`,
      );
    await reset(tx, id);
  }
  return {
    teamCount: row.teamCount,
    assignments,
    names: Array.from({ length: row.teamCount }, (_, i) => factionName(i + 1, row.names)),
  };
}
export async function organizeTeams(
  tx: Transaction,
  actor: Principal,
  id: string,
  body: Record<string, unknown>,
) {
  const party = await lockParty(tx, id, actor.userId);
  if (party.current || party.settings.mode !== "factions")
    throw new ApplicationError("invalid_transition", "Factions can only change in a lobby", 409);
  if (body.action === "lock") {
    if (party.host !== actor.userId)
      throw new ApplicationError("forbidden", "Only the host can lock faction changes", 403);
    if (typeof body.locked !== "boolean")
      throw new ApplicationError("invalid_input", "Invalid faction lock", 400);
    if (!!party.settings.factionChangesLocked !== body.locked) {
      await tx.execute(
        sql`UPDATE parties SET settings=jsonb_set(settings,'{factionChangesLocked}',${JSON.stringify(body.locked)}::jsonb) WHERE id=${id}::uuid`,
      );
      await reset(tx, id);
    }
    return teamLobby(tx, id);
  }
  const current = await teamLobby(tx, id);
  const me = (
    await tx.execute<{ id: string }>(
      sql`SELECT participant_id AS id FROM users WHERE id=${actor.userId}`,
    )
  ).rows[0].id;
  let assignments = current.assignments;
  let count = current.teamCount;
  let names = current.names;
  if (["balance", "create", "delete"].includes(String(body.action))) {
    if (party.host !== actor.userId)
      throw new ApplicationError("forbidden", "Only the host can organize all factions", 403);
    if (body.action === "create") {
      count++;
      validateTeamCount(count);
      let number = count;
      while (names.some((name) => name.toLowerCase() === `faction ${number}`)) number++;
      names = [...names, `Faction ${number}`];
    } else if (body.action === "delete") {
      const removed = body.team;
      if (
        typeof removed !== "number" ||
        !Number.isInteger(removed) ||
        removed < 1 ||
        removed > count
      )
        throw new ApplicationError("invalid_input", "Invalid faction", 400);
      count--;
      validateTeamCount(count);
      names = names.filter((_, i) => i + 1 !== removed);
      assignments = assignments.map((member) => ({
        ...member,
        team:
          member.team === removed ? null : member.team! > removed ? member.team! - 1 : member.team,
      }));
      const sizes = Array.from(
        { length: count },
        (_, i) => assignments.filter((member) => member.team === i + 1).length,
      );
      for (const member of assignments)
        if (member.team === null) {
          const smallest = sizes.indexOf(Math.min(...sizes));
          member.team = smallest + 1;
          sizes[smallest]!++;
        }
    } else assignments = balanceTeams(assignments, count);
  } else if (body.action === "rename") {
    const team = body.team;
    if (typeof team !== "number" || !Number.isInteger(team) || team < 1 || team > count)
      throw new ApplicationError("invalid_input", "Invalid faction", 400);
    if (
      party.host !== actor.userId &&
      (party.settings.factionChangesLocked ||
        !assignments.some((member) => member.userId === me && member.team === team))
    )
      throw new ApplicationError("forbidden", "You can only rename your own unlocked faction", 403);
    const parsed = factionNameSchema.safeParse(body.name);
    if (!parsed.success)
      throw new ApplicationError("invalid_input", parsed.error.issues[0]!.message, 400);
    const name = parsed.data;
    if (
      names.some((existing, i) => i + 1 !== team && existing.toLowerCase() === name.toLowerCase())
    )
      throw new ApplicationError("invalid_input", "Faction names must be unique", 400);
    names = names.map((existing, i) => (i + 1 === team ? name : existing));
  } else if (body.action === "assign") {
    if (party.settings.factionChangesLocked && party.host !== actor.userId)
      throw new ApplicationError("forbidden", "Faction changes are locked", 403);
    if (body.userId !== me && party.host !== actor.userId)
      throw new ApplicationError("forbidden", "Choose your own faction", 403);
    const team = body.team;
    if (typeof team !== "number" || !Number.isInteger(team) || team < 1 || team > count)
      throw new ApplicationError("invalid_input", "Invalid faction", 400);
    if (!assignments.some((m) => m.userId === body.userId))
      throw new ApplicationError("not_found", "Player unavailable", 404);
    assignments = assignments.map((m) =>
      m.userId === body.userId ? { ...m, team: team as number } : m,
    );
  } else throw new ApplicationError("invalid_input", "Invalid faction action", 400);
  if (
    count === current.teamCount &&
    JSON.stringify(names) === JSON.stringify(current.names) &&
    JSON.stringify(assignments) === JSON.stringify(current.assignments)
  )
    return current;
  await tx.execute(
    sql`UPDATE parties SET team_count=${count},faction_names=${JSON.stringify(names)}::jsonb WHERE id=${id}::uuid`,
  );
  for (const member of assignments)
    await tx.execute(
      sql`UPDATE party_members SET team=${member.team} WHERE party_id=${id}::uuid AND owner_id=(SELECT id FROM users WHERE participant_id=${member.userId})`,
    );
  await reset(tx, id);
  return teamLobby(tx, id);
}
