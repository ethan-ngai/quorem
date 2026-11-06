/** @file MatchEndView.tsx @description Settled match summary and dismissible result dialog. @module matches */
import { MatchCompletionActions } from "./MatchCompletionActions";
import { MatchWinnerMetadata } from "./MatchWinnerMetadata";
import { LeaveLobbyButton } from "./LeaveLobbyButton";
import { MatchSummaryMetadata } from "./MatchSummaryMetadata";
import { CompletionDialog } from "../completion/CompletionDialog";
import { PersistentNotice } from "../../ui/PersistentNotice";
import { useQueryClient } from "@tanstack/react-query";
import { readPendingCommand } from "./commandRecovery";
import { PartyReadyStatus } from "./PartyReadyStatus";
import { useActiveMatch } from "./useActiveMatch";
import { partyCommand, useParty } from "./party";
import { useEffect, useState } from "react";
import { participantUserId, type DevelopmentIdentity, type MatchSnapshot } from "@quorem/contracts";
import { outcomeLabel, ownParticipant, matchCompletionOutcome } from "./matchState";

/** Human explanations avoid exposing persistence reason codes. */
export function matchEndDescription(snapshot: MatchSnapshot, identity: DevelopmentIdentity) {
  const own = ownParticipant(snapshot, identity);
  if (own?.forfeited && !snapshot.outcome)
    return "You forfeited. The remaining players are still competing.";
  switch (snapshot.outcome?.reason) {
    case "first_correct":
      return "The first correct submission decided this match.";
    case "forfeit":
      return own?.forfeited
        ? "You forfeited this match."
        : "The match ended after a player forfeited.";
    case "host_left":
      return "The host closed the lobby before the match started.";
    case "deadline":
      return "Time is up. Final scores decided the result.";
  }
  if (snapshot.outcome?.kind === "no_contest")
    return "Judging could not finish reliably. No winner was declared.";
  if (snapshot.outcome?.kind === "draw") return "The match ended with equal scores.";
  if (snapshot.state === "cancelled") return "This lobby closed before the match finished.";
  return "Judging is complete. These are the final results.";
}
export function elapsedRoundTime(startedAt?: string, completedAt?: string) {
  if (!startedAt || !completedAt) return undefined;
  const seconds = Math.floor((Date.parse(completedAt) - Date.parse(startedAt)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`
    : `${minutes}:${remainder}`;
}

export function MatchEndView({
  snapshot,
  identity,
  open,
  onOpenChange,
  onReview,
}: {
  snapshot: MatchSnapshot;
  identity: DevelopmentIdentity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReview: () => void;
}) {
  const [celebrate, setCelebrate] = useState(open);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const client = useQueryClient();
  const partyQuery = useParty(identity);
  const candidateParty = partyQuery.data?.party;
  const party = candidateParty?.id === snapshot.partyId ? candidateParty : null;
  const activeMatch = useActiveMatch(
    identity,
    !!party?.currentMatchId && party.currentMatchId !== snapshot.id,
  );
  useEffect(() => {
    if (
      party?.currentMatchId &&
      party.currentMatchId !== snapshot.id &&
      activeMatch.match?.id === party.currentMatchId
    )
      window.location.assign(`/match/${party.currentMatchId}`);
  }, [party?.currentMatchId, snapshot.id, activeMatch.match?.id]);
  const member = party?.members.find((person) => person.userId === participantUserId(identity));
  const recovery =
    party &&
    readPendingCommand<{ ready: boolean }>(identity, `party:/v1/parties/${party.id}/ready`);
  const leaveRecovery =
    party && readPendingCommand(identity, `party:/v1/parties/${party.id}/leave`);
  const leaveLobby = async () => {
    if (!party || pending) return;
    setPending(true);
    setError("");
    try {
      await partyCommand(identity, `/v1/parties/${party.id}/leave`, "POST");
      await client.invalidateQueries({ queryKey: ["current-party", identity] });
    } catch {
      setError("Could not leave the lobby. Try again.");
    } finally {
      setPending(false);
    }
  };
  const toggleReady = async () => {
    if (!party || !member || pending) return;
    setPending(true);
    setError("");
    try {
      await partyCommand(identity, `/v1/parties/${party.id}/ready`, "POST", {
        ready: recovery?.payload.ready ?? !member.ready,
      });
      await client.invalidateQueries({ queryKey: ["current-party", identity] });
    } catch {
      setError("Could not update readiness. Try again.");
    } finally {
      setPending(false);
    }
  };
  const settled =
    (snapshot.state === "completed" || snapshot.state === "cancelled") &&
    !!snapshot.outcome &&
    !!snapshot.startedAt;
  const reviewPending = !!snapshot.startedAt && (!settled || !!snapshot.reviewPending);
  const actions = (
    <MatchCompletionActions
      review={
        settled || reviewPending
          ? {
              disabled: reviewPending,
              onClick: () => {
                setCelebrate(false);
                onReview();
              },
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
              disabled: pending || !!leaveRecovery || !member.online || !!party.currentMatchId,
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
  const title = forfeited ? "You forfeited" : outcomeLabel(snapshot, identity);
  const description = matchEndDescription(snapshot, identity);
  const players = [...snapshot.participants].sort(
    (a, b) =>
      Number(a.forfeited) - Number(b.forfeited) ||
      (b.bestScore?.passed ?? 0) - (a.bestScore?.passed ?? 0),
  );
  const partyStatus = (
    <div className="match-party-status">
      {(partyQuery.isPending || (partyQuery.isFetching && !candidateParty)) && (
        <span role="status">Checking lobby…</span>
      )}
      <PersistentNotice
        message={partyQuery.isError ? "Could not check your lobby. Try again." : undefined}
        label="Lobby unavailable"
        actions={[{ label: "Try again", onClick: () => void partyQuery.refetch() }]}
      />
    </div>
  );
  const standings = (
    <ol className="match-result-players" aria-label="Match results">
      {players.map((player) => (
        <li key={player.userId} data-you={player.userId === participantUserId(identity)}>
          <span>
            <strong>{player.displayName}</strong>
            {player.userId === participantUserId(identity) && <small>You</small>}
            {player.userId === snapshot.outcome?.winnerUserId && (
              <MatchWinnerMetadata
                elapsed={elapsedRoundTime(snapshot.startedAt, snapshot.outcome?.completedAt)}
              />
            )}
          </span>
          <span>
            {player.forfeited ? (
              "Forfeited"
            ) : player.bestScore ? (
              <>
                <strong>{player.bestScore.passed}</strong>
                <span className="result-score-total"> / {player.bestScore.total}</span>
              </>
            ) : (
              "—"
            )}
          </span>
        </li>
      ))}
    </ol>
  );
  return (
    <>
      {party && !partyQuery.isError && (
        <PartyReadyStatus
          members={party.members}
          countdownEndsAt={party.countdownEndsAt}
          queueError={party.queueError}
        />
      )}
      <CompletionDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setCelebrate(false);
          onOpenChange(next);
        }}
        celebrate={celebrate}
        title={title}
        description={description}
        context={
          <MatchSummaryMetadata
            mode={snapshot.mode}
            durationMinutes={snapshot.durationMinutes}
            difficulty={snapshot.difficulty}
          />
        }
        competitive
        outcome={outcome}
        pending={pending}
        headerActions={
          party && !partyQuery.isError && member ? (
            <LeaveLobbyButton disabled={pending} onClick={() => void leaveLobby()} />
          ) : undefined
        }
        actions={actions}
      >
        {standings}
        {reviewPending && (
          <p role="status">Code review will be available when the round and judging finish.</p>
        )}
        {party && !partyQuery.isError && (
          <PartyReadyStatus
            members={party.members}
            countdownEndsAt={party.countdownEndsAt}
            queueError={party.queueError}
          />
        )}
        {partyStatus}
        {error && <p role="alert">{error}</p>}
      </CompletionDialog>
    </>
  );
}
