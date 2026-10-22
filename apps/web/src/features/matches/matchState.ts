/** @file matchState.ts @description Participant selection and authoritative match display rules. @module matches */
import { participantUserId, type DevelopmentIdentity, type MatchSnapshot } from "@quorem/contracts";

export const freeForAll = { id: "free-for-all", name: "Free-for-all" } as const;
export const showdown = { id: "showdown", name: "Showdown" } as const;

/** @returns A return label only for a current, non-forfeited member of a live match. */
export function activeMatchReturnLabel(snapshot: MatchSnapshot, identity: DevelopmentIdentity) {
  const participant = ownParticipant(snapshot, identity);
  if (!participant || participant.forfeited) return null;
  if (snapshot.state === "waiting" || snapshot.state === "ready") return "Return to active lobby";
  if (snapshot.state === "active" || snapshot.state === "finalizing")
    return "Return to active match";
  return null;
}

/** @returns The missing participant/readiness action, without implying an absent opponent is ready. */
export function lobbyWaitingLabel(snapshot: MatchSnapshot, identity: DevelopmentIdentity) {
  const own = ownParticipant(snapshot, identity);
  const opponents = snapshot.participants.filter(
    (participant) => participant.userId !== participantUserId(identity),
  );
  if (!opponents.length) return "Waiting for opponent to join";
  if (opponents.some((participant) => !participant.ready))
    return snapshot.mode === "free-for-all"
      ? "Waiting for players to ready"
      : "Waiting for opponent to ready";
  if (!own?.ready) return "Waiting for you to ready";
  return snapshot.mode === "free-for-all" ? "Waiting for host to start" : "Starting Showdown…";
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
  const winner = snapshot.participants.find((player) => player.userId === outcome.winnerUserId);
  return outcome.winnerUserId === participantUserId(identity)
    ? "You won"
    : snapshot.mode === "free-for-all"
      ? `${winner?.displayName ?? "Another player"} won`
      : "Opponent won";
}
