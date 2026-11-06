/** @file competitors.ts @description Shared individual/team standings projection. @module matches */
import type { MatchSnapshot } from "@quorem/contracts";
type Player = MatchSnapshot["participants"][number];
export type Competitor = Player & { members: Player[] };
export function matchCompetitors(snapshot: MatchSnapshot): Competitor[] {
  if (snapshot.mode !== "factions")
    return snapshot.participants.map((player) => ({ ...player, members: [player] }));
  const teams = new Map<number, Player[]>();
  for (const player of snapshot.participants) {
    if (player.team === undefined) continue;
    const members = teams.get(player.team) ?? [];
    members.push(player);
    teams.set(player.team, members);
  }
  return [...teams].map(([team, members]) => ({
    ...(members.find((p) => !p.forfeited) ?? members[0]!),
    displayName: `Team ${team}`,
    members,
    forfeited: members.every((p) => p.forfeited),
    presence: members.some((p) => p.presence === "online") ? "online" : "offline",
  }));
}
export function isMatchWinner(snapshot: MatchSnapshot, player: Player | undefined) {
  return (
    !!player &&
    (snapshot.mode === "factions"
      ? player.team !== undefined && player.team === snapshot.outcome?.winnerTeam
      : player.userId === snapshot.outcome?.winnerUserId)
  );
}
