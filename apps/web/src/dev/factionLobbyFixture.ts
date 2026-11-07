import type { TeamLobby } from "@quorem/contracts/factions";
import type { PartySettings, PartySnapshot } from "@quorem/contracts";

export function saveFixtureSettings(party: PartySnapshot, settings: PartySettings) {
  party.settings = settings;
  party.version = (BigInt(party.version) + 1n).toString();
  party.members.forEach((member) => (member.ready = false));
  return party;
}

/** Fixture-only create/delete behavior for both lobby previews. */
export function resizeFactionFixture(
  lobby: TeamLobby,
  action: string,
  removed?: number,
): TeamLobby {
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
