/** @file matchTime.ts @description Settled round duration and shared clock formatting. @module matches */
import type { MatchSnapshot } from "@quorem/contracts";

/** @returns The viewer's submission cutoff before any new per-submit charge. */
export function personalSubmissionDeadline(match: MatchSnapshot, penaltySeconds = 0) {
  if (!match.deadline || match.rules.victory !== "race" || !penaltySeconds) return match.deadline;
  return new Date(Date.parse(match.deadline) - penaltySeconds * 1000).toISOString();
}

export function elapsedRoundSeconds(startedAt?: string, completedAt?: string) {
  if (!startedAt || !completedAt) return undefined;
  const seconds = Math.floor((Date.parse(completedAt) - Date.parse(startedAt)) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export function formatRoundTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`
    : `${minutes}:${remainder}`;
}

/** @returns A compact duration for a penalty badge, omitting zero seconds after whole minutes. */
export function formatPenaltyDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
