import { Vote } from "lucide-react";
import { useErrorNotification } from "../../ui/Notifications";
/** @file TeamVoteToast.tsx @description Team ballots in persistent nonmodal notifications. @module factions */
import { useEffect, useRef, useState } from "react";
import { teamVoteThreshold, type TeamVote, type TeamAction } from "@quorem/contracts/factions";
import { PersistentActionToast } from "../../ui/PersistentActionToast";
import { Check, ChevronDown, Clock3, X } from "lucide-react";
import { PersistentNotice } from "../../ui/PersistentNotice";
export function teamActionLabel(action: TeamAction) {
  switch (action.kind) {
    case "submit":
      return "Submit the proposed code";
    case "reveal":
      return action.target === "case" ? "Reveal a hidden test case" : `Reveal ${action.target}`;
    case "language":
      return `Change language to ${action.language}`;
    case "reset":
      return "Reset to starter code";
    case "concede":
      return "Concede the match";
  }
}
function Countdown({ expiresAt, onExpire }: { expiresAt: number; onExpire: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (now >= expiresAt) onExpire();
  }, [now, expiresAt, onExpire]);
  return (
    <span className="persistent-action-toast-countdown">
      <Clock3 size={12} aria-hidden="true" />
      {Math.max(0, Math.ceil((expiresAt - now) / 1000))}s left
    </span>
  );
}
export function TeamVoteToast({
  vote,
  identity,
  proposerName,
  serverNow,
  onVote,
  onCancel,
}: {
  vote: TeamVote;
  identity: string;
  proposerName: string;
  serverNow: number;
  onVote: (id: string, approve: boolean) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
}) {
  const [localExpiry] = useState(() => Date.now() + vote.expiresAt - serverNow);
  const [busy, setBusy] = useState(false);
  const acting = useRef(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string>();
  useErrorNotification(error);
  const [showCode, setShowCode] = useState(false);
  async function act(fn: () => Promise<void>) {
    if (acting.current || Date.now() >= localExpiry) return;
    acting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Vote could not be recorded. Try again.");
    } finally {
      acting.current = false;
      setBusy(false);
    }
  }
  const voted = Object.hasOwn(vote.ballots, identity);
  const yes = vote.electorate.filter((id) => vote.ballots[id] === true).length;
  const no = vote.electorate.filter((id) => vote.ballots[id] === false).length;
  return (
    <PersistentActionToast
      noun="vote"
      icon={<Vote size={14} aria-hidden="true" />}
      id={`team-vote:${vote.id}`}
      title={teamActionLabel(vote.quote.action)}
    >
      <div className="persistent-action-toast-context">
        <span>{proposerName} proposed</span>
        <Countdown expiresAt={localExpiry} onExpire={() => setExpired(true)} />
      </div>
      <div className="persistent-action-toast-summary">
        <span className="persistent-action-toast-cost">
          {[
            vote.quote.cost.seconds ? `+${vote.quote.cost.seconds}s time penalty` : null,
            vote.quote.cost.points ? `−${vote.quote.cost.points} points` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "No penalty"}
        </span>
        <span className="persistent-action-toast-meta">
          {yes}/{teamVoteThreshold(vote.electorate.length)} approvals · {no} rejected
        </span>
      </div>
      {vote.quote.action.kind === "submit" && (
        <>
          <button
            type="button"
            className="quiet-button persistent-action-toast-disclosure"
            onClick={() => setShowCode((v) => !v)}
            aria-expanded={showCode}
          >
            <ChevronDown size={14} aria-hidden="true" data-expanded={showCode} />
            {showCode ? "Hide" : "Review"} proposed code
          </button>
          {showCode && (
            <pre className="faction-vote-source" tabIndex={0} aria-label="Proposed code snapshot">
              <code>{vote.quote.action.source}</code>
            </pre>
          )}
        </>
      )}
      <div className="persistent-action-toast-actions">
        {!voted ? (
          <>
            <button
              type="button"
              className="button button-primary"
              disabled={busy || expired}
              onClick={() => void act(() => onVote(vote.id, true))}
            >
              <Check size={14} aria-hidden="true" /> Approve
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || expired}
              onClick={() => void act(() => onVote(vote.id, false))}
            >
              <X size={14} aria-hidden="true" /> Reject
            </button>
          </>
        ) : (
          <span className="persistent-action-toast-ballot" role="status">
            {vote.ballots[identity] ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <X size={14} aria-hidden="true" />
            )}
            {vote.ballots[identity] ? "You approved" : "You rejected"}
          </span>
        )}
        {vote.proposerId === identity && (
          <button
            type="button"
            className="quiet-button persistent-action-toast-cancel"
            disabled={busy || expired}
            onClick={() => void act(() => onCancel(vote.id))}
          >
            Cancel proposal
          </button>
        )}
        <PersistentNotice message={error} />
      </div>
    </PersistentActionToast>
  );
}
