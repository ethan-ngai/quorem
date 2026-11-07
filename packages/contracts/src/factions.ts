/** @file factions.ts @description Team lobby and voting contracts. @module contracts */
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
export type TeamLobby = { teamCount: number; assignments: TeamAssignment[] };
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
