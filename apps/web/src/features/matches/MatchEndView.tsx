/** @file MatchEndView.tsx @description Settled match summary and dismissible result dialog. @module matches */
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, Flag, Trophy, Minus, X } from "lucide-react";
import { useState } from "react";
import { participantUserId, type DevelopmentIdentity, type MatchSnapshot } from "@quorem/contracts";
import { outcomeLabel, ownParticipant } from "./matchState";

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
export function MatchEndView({
  snapshot,
  identity,
  guest,
}: {
  snapshot: MatchSnapshot;
  identity: DevelopmentIdentity;
  guest: boolean;
}) {
  const [open, setOpen] = useState(true);
  const own = ownParticipant(snapshot, identity);
  const forfeited = !!own?.forfeited;
  const won = snapshot.outcome?.winnerUserId === participantUserId(identity);
  const title = forfeited ? "You forfeited" : outcomeLabel(snapshot, identity);
  const description = matchEndDescription(snapshot, identity);
  const ResultIcon = forfeited ? Flag : won ? Trophy : Minus;
  const players = [...snapshot.participants].sort(
    (a, b) =>
      Number(a.forfeited) - Number(b.forfeited) ||
      (b.bestScore?.passed ?? 0) - (a.bestScore?.passed ?? 0),
  );
  return (
    <>
      <section className="match-page-content match-results-page">
        <header className="match-results-heading">
          <span className={`match-result-icon ${won ? "is-winner" : ""}`}>
            <ResultIcon size={24} />
          </span>
          <h1>{title}</h1>
          <p>{description}</p>
        </header>
        <ol className="match-result-players" aria-label="Match results">
          {players.map((player) => (
            <li key={player.userId} data-you={player.userId === participantUserId(identity)}>
              <span>
                <strong>{player.displayName}</strong>
                {player.userId === participantUserId(identity) && <small>You</small>}
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
        {guest && (
          <p className="match-guest-finished">
            Your guest session has ended. Sign in or continue browsing.
          </p>
        )}
        <footer className="match-results-actions">
          <button className="quiet-button" onClick={() => setOpen(true)}>
            Match summary
          </button>
          <a className="button button-primary" href="/practice">
            Back to practice
            <ArrowRight size={16} />
          </a>
        </footer>
      </section>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="settings-backdrop" />
          <Dialog.Content className="competitive-dialog match-end-dialog">
            <Dialog.Close asChild>
              <button className="icon-button match-dialog-close" aria-label="Close match summary">
                <X size={18} />
              </button>
            </Dialog.Close>
            <span className={`match-result-icon ${won ? "is-winner" : ""}`}>
              <ResultIcon size={24} />
            </span>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description>{description}</Dialog.Description>
            {own?.bestScore && (
              <div className="match-end-score">
                <strong>
                  {own.bestScore.passed}
                  <span> / {own.bestScore.total}</span>
                </strong>
                <span>cases passed</span>
              </div>
            )}
            <div className="competitive-dialog-actions">
              <Dialog.Close asChild>
                <button className="button button-secondary">Review results</button>
              </Dialog.Close>
              <a className="button button-primary" href="/practice">
                Back to practice
                <ArrowRight size={16} />
              </a>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
