import type { TeamLobby } from "@quorem/contracts/factions";
import type { PartySettings, PartySnapshot } from "@quorem/contracts";
import { readinessSettings } from "@quorem/contracts/match-rules";

export function saveFixtureSettings(party: PartySnapshot, settings: PartySettings) {
  if (JSON.stringify(party.settings) === JSON.stringify(settings)) return party;
  const before = readinessSettings(party.settings, settings.shareCodeAfterMatch);
  if (JSON.stringify(before) !== JSON.stringify(readinessSettings(settings)))
    party.members.forEach((member) => (member.ready = false));
  party.settings = settings;
  party.version = (BigInt(party.version) + 1n).toString();
  return party;
}

export function organizeFactionFixture(
  party: PartySnapshot,
  lobby: TeamLobby,
  body: { action: string; locked?: boolean; team?: number; name?: string; userId?: string },
): TeamLobby {
  if (body.action === "lock") {
    saveFixtureSettings(party, { ...party.settings, factionChangesLocked: body.locked });
    return lobby;
  }
  if (body.action === "rename") {
    const names = Array.from({ length: lobby.teamCount }, (_, i) => {
      const name = lobby.names?.[i] ?? `Faction ${i + 1}`;
      return i + 1 === body.team ? (body.name ?? name) : name;
    });
    return { ...lobby, names };
  }
  let next = resizeFactionFixture(lobby, body.action, body.team);
  if (body.action === "assign")
    next = {
      ...next,
      assignments: next.assignments.map((member) =>
        member.userId === body.userId ? { ...member, team: body.team ?? member.team } : member,
      ),
    };
  if (body.action === "balance")
    next = {
      ...next,
      assignments: next.assignments.map((member, i) => ({
        ...member,
        team: (i % next.teamCount) + 1,
      })),
    };
  if (
    next.teamCount !== lobby.teamCount ||
    JSON.stringify(next.assignments) !== JSON.stringify(lobby.assignments)
  )
    party.members.forEach((member) => (member.ready = false));
  return next;
}

/** Fixture-only create/delete behavior for both lobby previews. */
function resizeFactionFixture(lobby: TeamLobby, action: string, removed?: number): TeamLobby {
  if (action === "create")
    return {
      ...lobby,
      teamCount: Math.min(4, lobby.teamCount + 1),
      names: [
        ...(lobby.names ?? Array.from({ length: lobby.teamCount }, (_, i) => `Faction ${i + 1}`)),
        `Faction ${lobby.teamCount + 1}`,
      ],
    };
  if (action !== "delete" || !removed || lobby.teamCount <= 2) return lobby;
  const teamCount = lobby.teamCount - 1;
  const assignments = lobby.assignments.map((member) => ({
    ...member,
    team: member.team === removed ? null : member.team! > removed ? member.team! - 1 : member.team,
  }));
  const sizes = Array.from(
    { length: teamCount },
    (_, i) => assignments.filter((m) => m.team === i + 1).length,
  );
  for (const member of assignments)
    if (member.team === null) {
      const smallest = sizes.indexOf(Math.min(...sizes));
      member.team = smallest + 1;
      sizes[smallest]!++;
    }
  return { teamCount, assignments, names: lobby.names?.filter((_, i) => i + 1 !== removed) };
}
