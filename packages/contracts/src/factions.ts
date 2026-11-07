/** @file factions.ts @description Team lobby and voting contracts. @module contracts */
import { z } from "zod";

const factionNameLimit = 40;
const factionNameSegments = new Intl.Segmenter();
// Match complete emoji sequences so joiners and variation selectors are not allowed on their own.
const factionNameCharacters = new RegExp(
  String.raw`^(?:\p{RGI_Emoji}|\p{L}[\p{M}--\p{Default_Ignorable_Code_Point}]*|\p{N}| )*$`,
  "v",
);

export const factionNameInputSchema = z
  .string()
  .refine(
    (value) => factionNameCharacters.test(value) && !value.includes("  "),
    "Use letters, numbers, emoji, and single spaces.",
  )
  .refine((value) => {
    let length = 0;
    for (const _segment of factionNameSegments.segment(value))
      if (++length > factionNameLimit) return false;
    return true;
  }, `Use at most ${factionNameLimit} characters.`);
export const factionNameSchema = factionNameInputSchema
  .transform((value) => value.trim())
  .pipe(z.string().min(1, "Enter a faction name."));

export const factionLimits = {
  teams: 4,
  players: 8,
  voteDurationMs: 30_000,
  retryDelayMs: 5_000,
} as const;
export type TeamAssignment = { userId: string; team: number | null };
export type TeamAction =
  | {
      kind: "submit";
      workspaceId: string;
      level: number;
      source: string;
      language: string;
      documentEpoch: string;
      documentVersion: number;
    }
  | {
      kind: "reveal";
      target: "topics" | "complexity" | "case";
      caseIndex?: number;
      submissionId?: string;
    }
  | { kind: "language"; language: string; documentEpoch: string; documentVersion: number }
  | { kind: "reset"; documentEpoch: string; documentVersion: number }
  | { kind: "concede" };
export type TeamActionQuote = {
  action: TeamAction;
  ruleVersion: string;
  cost: { seconds: number; points: number };
};
export type TeamVoteState =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled"
  | "executed";
export type TeamVote = {
  id: string;
  proposerId: string;
  electorate: string[];
  ballots: Record<string, boolean>;
  quote: TeamActionQuote;
  state: TeamVoteState;
  createdAt: number;
  expiresAt: number;
  resolvedAt?: number;
};
export type TeamLobby = { teamCount: number; assignments: TeamAssignment[]; names?: string[] };
export function allFactionsOccupied(lobby: TeamLobby): boolean {
  return Array.from({ length: lobby.teamCount }, (_, i) => i + 1).every((team) =>
    lobby.assignments.some((member) => member.team === team),
  );
}

/** Strict majority of the admitted roster, independent of presence. */
export const teamVoteThreshold = (size: number) => Math.floor(size / 2) + 1;
export type TeamDocument = { source: string; version: number; epoch: string };
export type TeamPeer = {
  clientID: string;
  userId: string;
  name: string;
  color?: number;
  version: number;
  epoch: string;
  anchor: number;
  head: number;
};
export type TeamSnapshot = {
  team: number;
  workspaceId: string;
  language: string;
  serverNow: number;
  document: TeamDocument;
  members: { userId: string; name: string }[];
  votes: TeamVote[];
  peers: TeamPeer[];
  latestSubmissionId?: string;
};

export const factionName = (team: number, names?: readonly string[]) =>
  names?.[team - 1] || `Faction ${team}`;
