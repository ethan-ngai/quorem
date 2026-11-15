import { matchCompetitors, isMatchWinner } from "./competitors";
/** @file MatchEndView.tsx @description Settled match summary and dismissible result dialog. @module matches */
import { ParticipantName } from "../collaboration/ParticipantName";
import { ScorePenalty } from "./ScorePenalty";
import { MatchForfeitStatus } from "./MatchForfeitStatus";
import { ScoreProgress } from "../../ui/ScoreProgress";
import { participantColor } from "../collaboration/participantColor";
import { hasReviewCode, useMatchReview } from "./useMatchReview";
import { MatchCompletionActions, PlayerCodeReviewButton } from "./MatchCompletionActions";
import { MatchWinnerMetadata } from "./MatchWinnerMetadata";
import { LeaveLobbyButton } from "./LeaveLobbyButton";
import { MatchDurationRing } from "./MatchDurationRing";
import { elapsedRoundSeconds } from "./matchTime";
import { MatchSummaryMetadata } from "./MatchSummaryMetadata";
import { CompletionDialog } from "../completion/CompletionDialog";
import { PersistentNotice } from "../../ui/PersistentNotice";
import { LoadingIndicator } from "../../ui/Spinner";
import { useQueryClient } from "@tanstack/react-query";
import { readPendingCommand } from "./commandRecovery";
import { PartyReadyStatus, MatchLobbyReadiness, PartyReadinessIndicator } from "./PartyReadyStatus";
import { usePartyRoundNavigation } from "./useActiveMatch";
import { partyCommand, useParty } from "./party";
import { useState } from "react";
import { participantUserId, type DevelopmentIdentity, type MatchSnapshot } from "@quorem/contracts";
import { outcomeLabel, ownParticipant, matchCompletionOutcome } from "./matchState";

/** Human explanations avoid exposing persistence reason codes. */
export function matchEndDescription(snapshot: MatchSnapshot, identity: DevelopmentIdentity) {
  const own = ownParticipant(snapshot, identity);
  if (own?.forfeited && !snapshot.outcome)
    return "You forfeited. The remaining players are still competing.";
  switch (snapshot.outcome?.reason) {
    case "first_correct":
      return "The earliest correct submission after time penalties decided this match.";
    case "agreed_draw":
      return "Both players agreed to a draw.";
    case "forfeit":
      return own?.forfeited
        ? "You forfeited this match."
        : "The match ended after a player forfeited.";
    case "host_left":
      return "The host closed the lobby before the match started.";
    case "deadline_score":
      return "Time is up. Final scores after penalties decided the result.";
  }
  if (snapshot.outcome?.kind === "no_contest")
    return "Judging could not finish reliably. No winner was declared.";
  if (snapshot.outcome?.kind === "draw") return "The match ended with equal scores.";
  if (snapshot.state === "cancelled") return "This lobby closed before the match finished.";
  return "Judging is complete. These are the final results.";
}

export function MatchEndView({
  snapshot,
  identity,
  open,
  onOpenChange,
  onReview,
  problemTitle,
}: {
  snapshot: MatchSnapshot;
  identity: DevelopmentIdentity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReview: (participantId?: string) => void;
  problemTitle?: string;
}) {
  const [celebrate, setCelebrate] = useState(open);
  const [pendingOperation, setPendingOperation] = useState<"leave" | "ready">();
  const pending = pendingOperation !== undefined;
  const [error, setError] = useState("");
  const client = useQueryClient();
  const partyQuery = useParty(identity);
  const candidateParty = partyQuery.data?.party;
  const party = candidateParty?.id === snapshot.partyId ? candidateParty : null;
  usePartyRoundNavigation(
    identity,
    party?.currentMatchId === snapshot.id ? null : party?.currentMatchId,
  );
  const member = party?.members.find((person) => person.userId === participantUserId(identity));
  const recovery =
    party &&
    readPendingCommand<{ ready: boolean }>(identity, `party:/v1/parties/${party.id}/ready`);
  const leaveRecovery =
    party && readPendingCommand(identity, `party:/v1/parties/${party.id}/leave`);
  const leaveLobby = async () => {
    if (!party || pending) return;
    setPendingOperation("leave");
    setError("");
    try {
      await partyCommand(identity, `/v1/parties/${party.id}/leave`, "POST");
      await client.invalidateQueries({ queryKey: ["current-party", identity] });
    } catch {
      setError("Could not leave the lobby. Try again.");
    } finally {
      setPendingOperation(undefined);
    }
  };
  const toggleReady = async () => {
    if (!party || !member || pending) return;
    setPendingOperation("ready");
    setError("");
    try {
      await partyCommand(identity, `/v1/parties/${party.id}/ready`, "POST", {
        ready: recovery?.payload.ready ?? !member.ready,
      });
      await client.invalidateQueries({ queryKey: ["current-party", identity] });
    } catch {
      setError("Could not update readiness. Try again.");
    } finally {
      setPendingOperation(undefined);
    }
  };
  const settled =
    (snapshot.state === "completed" || snapshot.state === "cancelled") &&
    !!snapshot.outcome &&
    !!snapshot.startedAt;
  const reviewPending = !!snapshot.startedAt && (!settled || !!snapshot.reviewPending);
  const review = useMatchReview(identity, snapshot.id, open && settled && !reviewPending);
  const reviewableIds = new Set(
    settled && !reviewPending && !review.isError
      ? review.data?.participants.filter(hasReviewCode).map((player) => player.userId)
      : undefined,
  );
  const openReview = (participantId?: string) => {
    setCelebrate(false);
    onReview(participantId);
  };
  const actions = (
    <MatchCompletionActions
      review={
        settled || reviewPending
          ? {
              disabled: reviewPending,
              hasCode: reviewableIds.size > 0,
              onClick: () => openReview(),
            }
          : undefined
      }
      lobby={
        partyQuery.isError
          ? undefined
          : candidateParty
            ? "return"
            : !partyQuery.isFetching && partyQuery.data?.party === null
              ? "create"
              : undefined
      }
      readiness={
        party && !partyQuery.isError && member
          ? {
              ready: member.ready,
              pending: pendingOperation === "ready",
              disabled:
                pendingOperation === "leave" ||
                !!leaveRecovery ||
                !member.online ||
                !!party.currentMatchId,
              retry: !!recovery,
              onClick: () => void toggleReady(),
            }
          : undefined
      }
    />
  );
  const own = ownParticipant(snapshot, identity);
  const forfeited = !!own?.forfeited;
  const outcome = matchCompletionOutcome(snapshot, identity);
  const title =
    forfeited && outcome !== "draw" ? "You forfeited" : outcomeLabel(snapshot, identity);
  const description = matchEndDescription(snapshot, identity);
  const players = matchCompetitors(snapshot).sort(
    (a, b) =>
      Number(a.forfeited) - Number(b.forfeited) ||
      (b.adjustedScore ?? b.bestScore?.passed ?? 0) - (a.adjustedScore ?? a.bestScore?.passed ?? 0),
  );
  const checkingParty = partyQuery.isPending || (partyQuery.isFetching && !candidateParty);
  const highScore = snapshot.rules?.victory === "high_score";
  const partyStatus = (
    <div className="match-party-status" hidden={!checkingParty && !partyQuery.isError}>
      {checkingParty && <LoadingIndicator label="Checking lobby…" immediate />}
      <PersistentNotice
        message={partyQuery.isError ? "Could not check your lobby. Try again." : undefined}
        label="Lobby unavailable"
        actions={[{ label: "Try again", onClick: () => void partyQuery.refetch() }]}
      />
    </div>
  );
  const standings = (
    <ol className="match-result-players" aria-label="Match results">
      {players.map((player) => {
        const reviewPlayer = player.members.find((member) => reviewableIds.has(member.userId));
        return (
          <li key={player.userId} data-you={player.userId === participantUserId(identity)}>
            <span className="match-result-player">
              <strong>
                {snapshot.mode === "factions" ? (
                  <span>
                    {player.displayName} ·{" "}
                    {player.members.map((member) => member.displayName).join(", ")}
                  </span>
                ) : (
                  <ParticipantName
                    participant={player}
                    self={player.userId === participantUserId(identity)}
                    nameSuffix={isMatchWinner(snapshot, player) && <MatchWinnerMetadata />}
                  />
                )}
              </strong>
              {snapshot.mode === "factions" && isMatchWinner(snapshot, player) && (
                <MatchWinnerMetadata />
              )}
              {!player.forfeited && !highScore && !!player.penaltySeconds && (
                <ScorePenalty unit="seconds" value={player.penaltySeconds} />
              )}
            </span>
            <span className="match-result-score">
              {party && snapshot.mode !== "factions" && (
                <PartyReadinessIndicator
                  member={party.members.find((member) => member.userId === player.userId)}
                />
              )}
              {!player.forfeited && highScore && (
                <span>{player.adjustedScore ?? player.bestScore?.passed ?? 0} points</span>
              )}
              {player.forfeited ? (
                <MatchForfeitStatus />
              ) : (
                <span className="match-result-score-stack">
                  <ScoreProgress
                    score={player.bestScore}
                    color={participantColor(player.userId, player.color)}
                  />
                  {highScore && !!player.penaltyPoints && (
                    <ScorePenalty unit="points" value={player.penaltyPoints} />
                  )}
                </span>
              )}
              {reviewPlayer && (
                <PlayerCodeReviewButton
                  name={player.displayName}
                  onClick={() => openReview(reviewPlayer.userId)}
                />
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
  const readyStatus = party && !partyQuery.isError && (
    <PartyReadyStatus countdownEndsAt={party.countdownEndsAt} queueError={party.queueError} />
  );
  return (
    <>
      {!open && readyStatus}
      <CompletionDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setCelebrate(false);
          onOpenChange(next);
        }}
        celebrate={celebrate}
        title={title}
        description={problemTitle ?? description}
        context={<MatchSummaryMetadata mode={snapshot.mode} difficulty={snapshot.difficulty} />}
        competitive
        outcome={outcome}
        pending={pending}
        headerActions={
          <>
            <MatchDurationRing
              durationMinutes={snapshot.durationMinutes}
              elapsedSeconds={elapsedRoundSeconds(
                snapshot.startedAt,
                snapshot.outcome?.completedAt,
              )}
            />
            {party && !partyQuery.isError && member && (
              <LeaveLobbyButton pending={pending} onClick={() => void leaveLobby()} />
            )}
          </>
        }

        actions={actions}
      >
        {standings}
        {reviewPending && (
          <p role="status">Code review will be available when the round and judging finish.</p>
        )}
        {open && readyStatus}
        {party && snapshot.mode !== "factions" && (
          <MatchLobbyReadiness
            ownUserId={participantUserId(identity)}
            members={party.members}
            participantIds={snapshot.participants.map((player) => player.userId)}
            hostUserId={party.hostUserId}
          />
        )}
        {partyStatus}
        {error && <p role="alert">{error}</p>}
      </CompletionDialog>
    </>
  );
}
