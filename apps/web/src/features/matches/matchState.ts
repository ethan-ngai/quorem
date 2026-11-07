import { isMatchWinner } from "./competitors";
/** @file matchState.ts @description Participant selection and authoritative match display rules. @module matches */
import type { CompletionOutcome } from "../../ui/completionOutcome";
import { participantUserId, type DevelopmentIdentity, type MatchSnapshot } from "@quorem/contracts";

/** @returns A return label only for a current, non-forfeited member of a live match. */
export function activeMatchReturnLabel(snapshot: MatchSnapshot, identity: DevelopmentIdentity) {
  const participant = ownParticipant(snapshot, identity);
  if (!participant || participant.forfeited) return null;
  if (snapshot.state === "active" || snapshot.state === "finalizing") return "Return to match";
  return null;
}

/** @returns Only the current owner's participant; never an opponent's workspace. */
export function ownParticipant(snapshot: MatchSnapshot, identity: DevelopmentIdentity) {
  return snapshot.participants.find(
    (participant) => participant.userId === participantUserId(identity),
  );
}

/** @returns A clock display derived from the server's deadline and elapsed local time. */
export function remainingTime(deadline: string | undefined, serverNow: string, elapsedMs = 0) {
  if (!deadline) return "--:--";
  const seconds = Math.max(
    0,
    Math.ceil((Date.parse(deadline) - Date.parse(serverNow) - elapsedMs) / 1000),
  );
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

/** @returns A participant-relative terminal outcome label. */
export function outcomeLabel(snapshot: MatchSnapshot, identity: DevelopmentIdentity) {
  const outcome = snapshot.outcome;
  if (!outcome) return snapshot.state === "finalizing" ? "Finalizing results" : "Match ended";
  if (outcome.kind === "draw") return "Draw";
  if (outcome.kind === "no_contest") return "No contest";
  if (outcome.kind === "cancelled") return "Match cancelled";
  if (snapshot.mode === "factions")
    return isMatchWinner(snapshot, ownParticipant(snapshot, identity))
      ? "Victory"
      : `Team ${outcome.winnerTeam ?? "—"} won`;
  const winner = snapshot.participants.find((player) => player.userId === outcome.winnerUserId);
  return outcome.winnerUserId === participantUserId(identity)
    ? "Victory"
    : snapshot.mode === "free-for-all"
      ? `${winner?.displayName ?? "Another player"} won`
      : "Opponent won";
}

/** Normalize the result once; celebration primitives own viewer eligibility. */
export function matchCompletionOutcome(
  snapshot: MatchSnapshot,
  identity: DevelopmentIdentity,
): CompletionOutcome {
  const own = ownParticipant(snapshot, identity);
  if (own?.forfeited) return "loss";
  if (snapshot.state !== "completed") return snapshot.state === "cancelled" ? "neutral" : "pending";
  if (snapshot.outcome?.kind !== "win") return "neutral";
  if (!own) return "observer";
  return isMatchWinner(snapshot, own) ? "success" : "loss";
}
