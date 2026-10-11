/** @file MatchPage.tsx @description Private lobby, match ledger, and owner-scoped editor entry. @module matches */
import {
  developmentUserIds,
  type CreateMatchRequest,
  type DevelopmentIdentity,
  type MatchSnapshot,
} from "@quorem/contracts";
import { useEffect, useRef, useState } from "react";
import { WorkspacePage } from "../editor/WorkspacePage";
import { Tooltip } from "../editor/components/Tooltip";
import { Brand, Icon } from "../editor/components/Icon";
import { useTheme } from "../editor/useTheme";
import { useMatchSync } from "../realtime/useMatchSync";
import { forfeitMatch, leaveMatch, setReady, updateMatchSettings } from "./api";
import { IdentityChoice, MatchSettings, useLocalIdentity } from "./MatchControls";
import { ConcessionDialog } from "./ConcessionDialog";
import { CopyFeedbackIcon } from "./CopyFeedbackIcon";
import { readInvite } from "./commandRecovery";
import { outcomeLabel, ownParticipant, remainingTime } from "./matchState";
import "../../styles/workspace.css";

/** @returns A deadline clock anchored to each authoritative server snapshot. */
function MatchClock({ snapshot }: { snapshot: MatchSnapshot }) {
  const received = useRef({ version: snapshot.serverNow, at: Date.now() });
  if (received.current.version !== snapshot.serverNow)
    received.current = { version: snapshot.serverNow, at: Date.now() };
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
    <div className="competitive-scoreboard" aria-label="Match progress">
      {[own, opponent].map((player, index) => (
        <div className="competitive-player-score" key={index}>
          <Tooltip
            content={player?.presence === "online" ? "Online" : "Disconnected; the clock continues"}
          >
            <span
              className={`presence-dot ${player?.presence ?? "offline"}`}
              role="img"
              aria-label={player?.presence ?? "offline"}
            />
          </Tooltip>
          <strong>{index === 0 ? "You" : (player?.displayName ?? "Opponent")}</strong>
          <Tooltip content="Best submission: cases passed">
            <span className="competitive-score" tabIndex={0}>
              {player?.bestScore ? `${player.bestScore.passed}/${player.bestScore.total}` : "—"}
            </span>
          </Tooltip>
          {(player?.submissionState === "running" || player?.submissionState === "queued") && (
            <span className="score-judging">Judging…</span>
          )}
        </div>
      ))}
      <div className="competitive-clock-actions">
        {status !== "live" && (
          <Tooltip content="Connection interrupted; refreshing match state">
            <span className="sync-label">Reconnecting…</span>
          </Tooltip>
        )}
        {snapshot.state === "active" ? <MatchClock snapshot={snapshot} /> : null}
        {(snapshot.state === "active" || snapshot.state === "finalizing") && (
          <Tooltip content="Forfeit match">
            <button
              className="icon-button destructive-icon"
              aria-label="Forfeit match"
              onClick={onForfeit}
            >
              <Icon name="flag" />
            </button>
          </Tooltip>
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
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (snapshot?.state === "completed" || snapshot?.state === "cancelled") setConceding(false);
  }, [snapshot?.state]);
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
          <h1>{error ? "Match unavailable" : "Opening match…"}</h1>
          {error && (
            <>
              <p role="alert">{error instanceof Error ? error.message : String(error)}</p>
              <button className="button button-secondary" onClick={() => void refetch()}>
                Retry
              </button>
              <a className="text-link" href="/run-widths">
                Back to practice
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
  const inviteUrl = readInvite(identity, matchId);
  const concession = (
    <ConcessionDialog
      open={conceding}
      pending={pending}
      error={actionError}
      onCancel={() => setConceding(false)}
      onConfirm={() =>
        void command(async () => {
          await forfeitMatch(identity, matchId);
          setConceding(false);
        })
      }
    />
  );
  const ledger = (
    <>
      <MatchLedger
        snapshot={snapshot}
        identity={identity}
        status={status}
        onForfeit={() => setConceding(true)}
      />
      {snapshot.state !== "active" && (
        <div
          className={`match-terminal competitive-outcome ${snapshot.outcome?.winnerUserId === developmentUserIds[identity] ? "is-winner" : ""}`}
          role="status"
        >
          <strong>{outcomeLabel(snapshot, identity)}</strong>
          <span>
            {snapshot.state === "finalizing"
              ? "Admitted submissions are still being judged. Scores settle before the final outcome."
              : snapshot.outcome?.reason.replaceAll("_", " ")}
          </span>
          <a href="/run-widths">Back to practice</a>
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
        <div className="competitive-lobby-heading">
          <div>
            <h1>{closed ? outcomeLabel(snapshot, identity) : "Private 1v1"}</h1>
            {closed && <p>{snapshot.outcome?.reason.replaceAll("_", " ")}</p>}
          </div>
          {!closed && (
            <Tooltip content="Leave lobby">
              <button
                className="icon-button destructive-icon"
                aria-label="Leave lobby"
                disabled={pending}
                onClick={() =>
                  void command(async () => {
                    await leaveMatch(identity, matchId);
                    window.location.assign("/run-widths");
                  })
                }
              >
                <Icon name="output" />
              </button>
            </Tooltip>
          )}
        </div>
        {!closed && (
          <>
            <div className="competitive-seats" aria-label="Players">
              {snapshot.participants.map((participant) => (
                <div className="competitive-seat" key={participant.userId}>
                  <span className="participant-avatar">{participant.displayName.slice(0, 1)}</span>
                  <div>
                    <strong>
                      {participant.userId === developmentUserIds[identity]
                        ? `${participant.displayName} (you)`
                        : participant.displayName}
                    </strong>
                    <span>{participant.userId === snapshot.hostUserId ? "Host" : "Opponent"}</span>
                  </div>
                  <Tooltip content={participant.ready ? "Ready" : "Not ready"}>
                    <span
                      className={`seat-readiness ${participant.ready ? "is-ready" : ""}`}
                      role="img"
                      aria-label={participant.ready ? "Ready" : "Not ready"}
                      tabIndex={0}
                    >
                      <Icon name={participant.ready ? "ready" : "clock"} />
                    </span>
                  </Tooltip>
                </div>
              ))}
              {snapshot.participants.length < 2 && (
                <div className="competitive-seat waiting-seat">
                  <span className="participant-avatar">
                    <Icon name="people" />
                  </span>
                  <div>
                    <strong>Open seat</strong>
                    <span>Invite your opponent</span>
                  </div>
                </div>
              )}
            </div>
            {host ? (
              <div className="competitive-lobby-settings">
                <MatchSettings
                  value={settings}
                  disabled={pending}
                  onChange={(next) => {
                    if (
                      next.difficulty === settings.difficulty &&
                      next.durationMinutes === settings.durationMinutes
                    )
                      return;
                    setSettings(next);
                    void command(async () => {
                      try {
                        await updateMatchSettings(identity, matchId, next);
                      } catch (cause) {
                        setSettings({
                          difficulty: snapshot.difficulty,
                          durationMinutes: snapshot.durationMinutes,
                        });
                        throw cause;
                      }
                    });
                  }}
                />
              </div>
            ) : (
              <dl className="competitive-lobby-summary">
                <div>
                  <dt>
                    <Icon name="target" />
                    Difficulty
                  </dt>
                  <dd>{snapshot.difficulty}</dd>
                </div>
                <div>
                  <dt>
                    <Icon name="clock" />
                    Duration
                  </dt>
                  <dd>{snapshot.durationMinutes} minutes</dd>
                </div>
              </dl>
            )}
            {inviteUrl && host && (
              <div className="competitive-invite">
                <label htmlFor="invite-link">
                  <Icon name="people" />
                  Invitation
                </label>
                <div>
                  <input
                    id="invite-link"
                    value={inviteUrl}
                    readOnly
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <Tooltip content={copied ? "Copied" : "Copy invitation"}>
                    <button
                      className={`icon-button copy-invitation ${copied ? "is-copied" : ""}`}
                      aria-label={copied ? "Copied" : "Copy invitation"}
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(inviteUrl)
                          .then(() => setCopied(true))
                          .catch(() =>
                            setActionError("Copy unavailable. Select and copy the link."),
                          )
                      }
                    >
                      <CopyFeedbackIcon copied={copied} />
                    </button>
                  </Tooltip>
                </div>
              </div>
            )}
            <footer className="competitive-lobby-footer">
              <span role="status">
                {status !== "live"
                  ? "Reconnecting…"
                  : own?.ready
                    ? "Waiting for opponent to ready up"
                    : snapshot.participants.length < 2
                      ? "Waiting for opponent to join"
                      : "Opponent joined. Ready to begin?"}
              </span>
              <button
                className={`button ${own?.ready ? "button-secondary" : "button-primary"}`}
                disabled={pending || !own}
                onClick={() => void command(() => setReady(identity, matchId, !own?.ready))}
              >
                <Icon name={own?.ready ? "close" : "submit"} />
                {pending ? "Updating…" : own?.ready ? "Cancel ready" : "Ready up"}
              </button>
            </footer>
          </>
        )}
        {(actionError || error) && (
          <p role="alert" className="result-error">
            {actionError ?? (error instanceof Error ? error.message : String(error))}
          </p>
        )}
        {closed && (
          <a className="text-link" href="/run-widths">
            Back to practice
          </a>
        )}
      </section>
    </main>
  );
}
