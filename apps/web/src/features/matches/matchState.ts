/** @file matchState.ts @description Participant selection and authoritative match display rules. @module matches */
import {
  developmentUserIds,
  type DevelopmentIdentity,
  type MatchSnapshot,
} from "@quorem/contracts";

export const showdown = { id: "showdown", name: "Showdown" } as const;

/** @returns The missing participant/readiness action, without implying an absent opponent is ready. */
export function lobbyWaitingLabel(snapshot: MatchSnapshot, identity: DevelopmentIdentity) {
  const own = ownParticipant(snapshot, identity);
  const opponent = snapshot.participants.find(
    (participant) => participant.userId !== developmentUserIds[identity],
  );
  if (!opponent) return "Waiting for opponent to join";
  if (!opponent.ready) return "Waiting for opponent to ready";
  if (!own?.ready) return "Waiting for you to ready";
  return "Starting Showdown…";
}

/** @returns Only the current owner's participant; never an opponent's workspace. */
export function ownParticipant(snapshot: MatchSnapshot, identity: DevelopmentIdentity) {
  return snapshot.participants.find(
    (participant) => participant.userId === developmentUserIds[identity],
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
  return outcome.winnerUserId === developmentUserIds[identity] ? "You won" : "Opponent won";
}
