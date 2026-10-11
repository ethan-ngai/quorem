/** @file MatchPage.tsx @description Private lobby, match ledger, and owner-scoped editor entry. @module matches */
import {
  developmentUserIds,
  type CreateMatchRequest,
  type DevelopmentIdentity,
  type MatchSnapshot,
} from "@quorem/contracts";
import { useEffect, useRef, useState } from "react";
import { WorkspacePage } from "../editor/WorkspacePage";
import { Brand, Icon } from "../editor/components/Icon";
import { useTheme } from "../editor/useTheme";
import { useMatchSync } from "../realtime/useMatchSync";
import { forfeitMatch, leaveMatch, setReady, updateMatchSettings } from "./api";
import { IdentityChoice, MatchSettings, useLocalIdentity } from "./MatchControls";
import { outcomeLabel, ownParticipant, remainingTime } from "./matchState";
import "../../styles/workspace.css";

/** @returns A deadline clock anchored to each authoritative server snapshot. */
function MatchClock({ snapshot }: { snapshot: MatchSnapshot }) {
  const received = useRef({ version: snapshot.version, at: Date.now() });
  if (received.current.version !== snapshot.version)
    received.current = { version: snapshot.version, at: Date.now() };
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className="match-clock">
      <Icon name="clock" />
      {remainingTime(snapshot.deadline, snapshot.serverNow, Math.max(0, now - received.current.at))}
    </span>
  );
}

/** @returns Safe participant scores and connection state, never source or private cases. */
function MatchLedger({
  snapshot,
  identity,
  status,
  onForfeit,
}: {
  snapshot: MatchSnapshot;
  identity: DevelopmentIdentity;
  status: string;
  onForfeit: () => void;
}) {
  const own = ownParticipant(snapshot, identity);
  const opponent = snapshot.participants.find(
    (participant) => participant.userId !== developmentUserIds[identity],
  );
  return (
    <div className="match-ledger">
      <div className="match-ledger-title">
        <span className="eyebrow">Private 1v1</span>
        <span className="sync-label">
          {status === "live"
            ? "Live"
            : status === "polling"
              ? "Reconnecting · polling"
              : "Connecting…"}
        </span>
      </div>
      <div className="participant-score">
        <strong>You</strong>
        <span>{own?.bestScore ? `${own.bestScore.passed}/${own.bestScore.total}` : "—"}</span>
        <small>Best score</small>
      </div>
      <span className="versus">vs</span>
      <div className="participant-score">
        <strong>{opponent?.displayName ?? "Opponent"}</strong>
        <span>
          {opponent?.bestScore ? `${opponent.bestScore.passed}/${opponent.bestScore.total}` : "—"}
        </span>
        <small>
          <i className={`presence-dot ${opponent?.presence}`} />
          {opponent?.presence ?? "offline"}
          {opponent?.submissionState ? ` · ${opponent.submissionState}` : ""}
        </small>
      </div>
      <div className="match-ledger-end">
        {snapshot.state === "active" ? (
          <>
            <MatchClock snapshot={snapshot} />
            <button className="quiet-button" onClick={onForfeit}>
              Forfeit
            </button>
          </>
        ) : (
          <strong className="match-outcome">{outcomeLabel(snapshot, identity)}</strong>
        )}
      </div>
    </div>
  );
}

/** @returns A fully authoritative match route, revealing the problem only after start. */
export function MatchPage({ matchId }: { matchId: string }) {
  const { identity, setIdentity } = useLocalIdentity();
  useTheme();
  const { snapshot, error, status, refetch } = useMatchSync(identity, matchId);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [conceding, setConceding] = useState(false);
  const [settings, setSettings] = useState<CreateMatchRequest>({
    difficulty: "easy",
    durationMinutes: 30,
  });
  useEffect(() => {
    if (snapshot)
      setSettings({ difficulty: snapshot.difficulty, durationMinutes: snapshot.durationMinutes });
  }, [snapshot?.difficulty, snapshot?.durationMinutes]);
  const command = async (action: () => Promise<unknown>) => {
    if (pending) return;
    setPending(true);
    setActionError(undefined);
    try {
      await action();
      await refetch();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Match request failed.");
    } finally {
      setPending(false);
    }
  };
  if (!snapshot)
    return (
      <main className="match-page">
        <header className="topbar">
          <Brand />
          <div className="topbar-spacer" />
          <IdentityChoice identity={identity} onChange={setIdentity} />
        </header>
        <section className="match-page-content">
          <span className="eyebrow">Private 1v1</span>
          <h1>{error ? "Match unavailable" : "Opening match…"}</h1>
          {error && (
            <>
              <p role="alert">{error instanceof Error ? error.message : String(error)}</p>
              <button className="button button-secondary" onClick={() => void refetch()}>
                Retry
              </button>
              <a className="text-link" href="/run-widths">
                Return to practice →
              </a>
            </>
          )}
        </section>
      </main>
    );
  const own = ownParticipant(snapshot, identity);
  const host = snapshot.hostUserId === developmentUserIds[identity];
  const started = ["active", "finalizing", "completed"].includes(snapshot.state);
  const ownWorkspaceId = started ? own?.workspaceId : undefined;
  const inviteUrl = sessionStorage.getItem(`quorem.invite.${identity}.${matchId}`);
  const concession = conceding ? (
    <dialog open className="concession-dialog" aria-labelledby="concession-title">
      <h2 id="concession-title">Concede this match?</h2>
      <p>Your opponent wins. This cannot be undone.</p>
      <div className="dialog-actions">
        <button
          className="button button-secondary"
          disabled={pending}
          onClick={() => setConceding(false)}
        >
          Keep playing
        </button>
        <button
          className="button button-danger"
          disabled={pending}
          onClick={() =>
            void command(async () => {
              await forfeitMatch(identity, matchId);
              setConceding(false);
            })
          }
        >
          {pending ? "Conceding…" : "Forfeit match"}
        </button>
      </div>
      {actionError && (
        <p role="alert" className="result-error">
          {actionError}
        </p>
      )}
    </dialog>
  ) : null;
  const ledger = (
    <>
      <MatchLedger
        snapshot={snapshot}
        identity={identity}
        status={status}
        onForfeit={() => setConceding(true)}
      />
      {snapshot.state !== "active" && (
        <div className="match-terminal">
          <strong>{outcomeLabel(snapshot, identity)}</strong>
          <span>
            {snapshot.state === "finalizing"
              ? "Admitted submissions are still being judged. Scores settle before the final outcome."
              : snapshot.outcome?.reason.replaceAll("_", " ")}
          </span>
          <a href="/run-widths">Return to practice →</a>
        </div>
      )}
      {error && (
        <p className="sync-error" role="status">
          Connection interrupted. Refreshing authoritative state.
        </p>
      )}
      {concession}
    </>
  );
  if (ownWorkspaceId && snapshot.problemVersionId)
    return (
      <WorkspacePage
        match={snapshot}
        matchWorkspaceId={ownWorkspaceId}
        identity={identity}
        onIdentityChange={setIdentity}
        matchHeader={ledger}
      />
    );
  const closed = snapshot.state === "cancelled" || snapshot.state === "completed";
  return (
    <main className="match-page">
      <header className="topbar">
        <Brand />
        <span className="workspace-mode">Private 1v1</span>
        <div className="topbar-spacer" />
        <IdentityChoice identity={identity} onChange={setIdentity} />
      </header>
      <section className="match-page-content">
        <div className="lobby-heading">
          <span className="eyebrow">
            {closed ? "Match closed" : host ? "Your private lobby" : "Private lobby"}
          </span>
          <h1>{closed ? outcomeLabel(snapshot, identity) : "Ready when you are."}</h1>
          <p>
            {closed
              ? snapshot.outcome?.reason.replaceAll("_", " ")
              : "The problem stays hidden until both players are ready. Each player has a private editor."}
          </p>
        </div>
        {!closed && (
          <>
            <div className="lobby-participants">
              {snapshot.participants.map((participant) => (
                <div className="lobby-participant" key={participant.userId}>
                  <span className="participant-avatar">{participant.displayName.slice(0, 1)}</span>
                  <div>
                    <strong>
                      {participant.displayName}
                      {participant.userId === developmentUserIds[identity] ? " (you)" : ""}
                    </strong>
                    <span>
                      {participant.userId === snapshot.hostUserId ? "Host" : "Guest"} ·{" "}
                      {participant.presence}
                    </span>
                  </div>
                  <span className={`ready-label ${participant.ready ? "is-ready" : ""}`}>
                    {participant.ready ? "Ready" : "Not ready"}
                  </span>
                </div>
              ))}
              {snapshot.participants.length < 2 && (
                <div className="lobby-participant waiting-seat">
                  <Icon name="people" />
                  <div>
                    <strong>Waiting for opponent</strong>
                    <span>Share your private invitation</span>
                  </div>
                </div>
              )}
            </div>
            {host ? (
              <form
                className="lobby-settings"
                onSubmit={(event) => {
                  event.preventDefault();
                  void command(() => updateMatchSettings(identity, matchId, settings));
                }}
              >
                <span className="eyebrow">Match settings</span>
                <MatchSettings value={settings} onChange={setSettings} disabled={pending} />
                <button
                  className="button button-secondary"
                  disabled={
                    pending ||
                    (settings.difficulty === snapshot.difficulty &&
                      settings.durationMinutes === snapshot.durationMinutes)
                  }
                >
                  Update settings
                </button>
                <small>Changing settings clears both ready states.</small>
              </form>
            ) : (
              <dl className="lobby-summary">
                <div>
                  <dt>Difficulty</dt>
                  <dd>{snapshot.difficulty}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{snapshot.durationMinutes} minutes</dd>
                </div>
              </dl>
            )}
            {inviteUrl && host && (
              <div className="invite-link">
                <label htmlFor="invite-link">Private invite link</label>
                <div>
                  <input id="invite-link" value={inviteUrl} readOnly />
                  <button
                    className="button button-secondary"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(inviteUrl)
                        .then(() => setCopied(true))
                        .catch(() => setActionError("Copy unavailable. Select and copy the link."))
                    }
                  >
                    <Icon name="copy" />
                    {copied ? "Copied" : "Copy link"}
                  </button>
                </div>
              </div>
            )}
            <div className="lobby-actions">
              <button
                className={`button ${own?.ready ? "button-secondary" : "button-primary"}`}
                disabled={pending || !own}
                onClick={() => void command(() => setReady(identity, matchId, !own?.ready))}
              >
                {pending ? "Updating…" : own?.ready ? "Not ready" : "I'm ready"}
                <Icon name="submit" />
              </button>
              <button
                className="quiet-button"
                disabled={pending}
                onClick={() =>
                  void command(async () => {
                    await leaveMatch(identity, matchId);
                    window.location.assign("/run-widths");
                  })
                }
              >
                Leave lobby
              </button>
              <span>{status === "live" ? "Live updates" : "Reconnecting · polling"}</span>
            </div>
            <p className="lobby-expiry">
              Invitation expires {new Date(snapshot.expiresAt).toLocaleString()}
            </p>
          </>
        )}
        {(actionError || error) && (
          <p role="alert" className="result-error">
            {actionError ?? (error instanceof Error ? error.message : String(error))}
          </p>
        )}
        {closed && (
          <a className="text-link" href="/run-widths">
            Return to practice →
          </a>
        )}
      </section>
    </main>
  );
}
