/** @file policy.ts @description Deterministic team organization and vote transitions. @module factions */
import {
  factionLimits,
  teamVoteThreshold,
  type TeamAssignment,
  type TeamVote,
  type TeamActionQuote,
} from "@quorem/contracts/factions";
import { ApplicationError } from "../../application/error.ts";
const invalid = (message: string) => new ApplicationError("invalid_input", message, 400);
const conflict = (message: string) => new ApplicationError("invalid_transition", message, 409);
export function validateTeamCount(count: number) {
  if (!Number.isInteger(count) || count < 2 || count > factionLimits.teams)
    throw invalid("Choose 2–4 teams");
}
/** Stable balancing minimizes moves while filling the smallest teams. */
export function balanceTeams(members: readonly TeamAssignment[], count: number): TeamAssignment[] {
  validateTeamCount(count);
  if (
    members.length > factionLimits.players ||
    new Set(members.map((m) => m.userId)).size !== members.length
  )
    throw invalid("Invalid team roster");
  const sizes = Array.from({ length: count }, () => 0);
  const target = Array.from({ length: count }, () => Math.floor(members.length / count));
  const popularity = Array.from({ length: count }, (_, index) => ({
    index,
    size: members.filter((member) => member.team === index + 1).length,
  })).sort((a, b) => b.size - a.size || a.index - b.index);
  for (const { index } of popularity.slice(0, members.length % count)) target[index]!++;
  const result = members.map((member) => {
    const team = member.team;
    if (
      team !== null &&
      Number.isInteger(team) &&
      team >= 1 &&
      team <= count &&
      sizes[team - 1]! < target[team - 1]!
    ) {
      sizes[team - 1]!++;
      return { ...member };
    }
    return { userId: member.userId, team: null };
  });
  for (const member of result)
    if (member.team === null) {
      const index = sizes.findIndex((size, i) => size < target[i]!);
      member.team = index + 1;
      sizes[index]!++;
    }
  return result;
}
export function requireReadyTeams(members: readonly TeamAssignment[], count: number) {
  validateTeamCount(count);
  if (
    members.length < 2 ||
    members.length > factionLimits.players ||
    members.some(
      (m) => m.team === null || !Number.isInteger(m.team) || m.team < 1 || m.team > count,
    ) ||
    new Set(members.map((m) => m.team)).size < 2
  )
    throw conflict("Assign everyone to at least two teams");
}
export function resolveVote(vote: TeamVote, now: number): TeamVote {
  if (vote.state !== "pending") return vote;
  // Deadline wins over a ballot arriving at the exact expiry instant.
  if (now >= vote.expiresAt) return { ...vote, state: "expired", resolvedAt: now };
  const yes = vote.electorate.filter((id) => vote.ballots[id] === true).length;
  const no = vote.electorate.filter((id) => vote.ballots[id] === false).length;
  const needed = teamVoteThreshold(vote.electorate.length);
  if (yes >= needed) return { ...vote, state: "approved", resolvedAt: now };
  if (vote.electorate.length - no < needed) return { ...vote, state: "rejected", resolvedAt: now };
  return vote;
}
export function proposeVote(
  id: string,
  proposerId: string,
  electorate: string[],
  quote: TeamActionQuote,
  now: number,
): TeamVote {
  if (
    !electorate.includes(proposerId) ||
    electorate.length < 1 ||
    electorate.length > factionLimits.players ||
    new Set(electorate).size !== electorate.length
  )
    throw invalid("Invalid voting roster");
  return resolveVote(
    {
      id,
      proposerId,
      electorate: [...electorate],
      ballots: { [proposerId]: true },
      quote,
      state: "pending",
      createdAt: now,
      expiresAt: now + factionLimits.voteDurationMs,
    },
    now,
  );
}
export function castVote(vote: TeamVote, actor: string, approve: boolean, now: number): TeamVote {
  if (!vote.electorate.includes(actor))
    throw new ApplicationError("forbidden", "Only teammates can vote", 403);
  const current = resolveVote(vote, now);
  if (current.state !== "pending") return current;
  if (Object.hasOwn(current.ballots, actor)) {
    if (current.ballots[actor] !== approve) throw conflict("Your vote is already recorded");
    return current;
  }
  return resolveVote({ ...current, ballots: { ...current.ballots, [actor]: approve } }, now);
}
export function cancelVote(vote: TeamVote, actor: string, now: number): TeamVote {
  if (actor !== vote.proposerId)
    throw new ApplicationError("forbidden", "Only the proposer can cancel", 403);
  const current = resolveVote(vote, now);
  return current.state === "pending"
    ? { ...current, state: "cancelled", resolvedAt: now }
    : current;
}
