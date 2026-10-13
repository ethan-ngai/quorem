/** @file MatchPage.tsx @description Private lobby, match ledger, and owner-scoped editor entry. @module matches */
import {
  participantUserId,
  type CreateMatchRequest,
  type DevelopmentIdentity,
  type MatchSnapshot,
} from "@quorem/contracts";
import { useEffect, useRef, useState } from "react";
import { WorkspacePage } from "../editor/WorkspacePage";
import { Tooltip } from "../editor/components/Tooltip";
import { Icon } from "../editor/components/Icon";
import { useTheme } from "../editor/useTheme";
import { useMatchSync } from "../realtime/useMatchSync";
import { forfeitMatch, leaveMatch, setReady, startMatch, updateMatchSettings } from "./api";
import { MatchSettings, ModeIcon, defaultMatchSettings, useAccountIdentity } from "./MatchControls";
import { ConcessionDialog } from "./ConcessionDialog";
import { InvitationActions } from "./InvitationActions";
import { ReadinessIcon } from "./ReadinessIcon";
import { ReadyActionIcon } from "./ReadyActionIcon";
import { shareInvitation } from "./shareInvitation";
import { readInvite } from "./commandRecovery";
import {
  lobbyWaitingLabel,
  outcomeLabel,
  ownParticipant,
  remainingTime,
  showdown,
  freeForAll,
} from "./matchState";
import { GlobalNav } from "../navigation/GlobalNav";
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
  return (
    <div className="competitive-scoreboard" aria-label="Match progress">
      {[own, ...snapshot.participants.filter((player) => player.userId !== own?.userId)].map(
        (player, index) => (
          <div className="competitive-player-score" key={index}>
            <Tooltip
              content={
                player?.presence === "online" ? "Online" : "Disconnected; the clock continues"
              }
            >
              <span
                className={`presence-dot ${player?.presence ?? "offline"}`}
                role="img"
                aria-label={player?.presence ?? "offline"}
              />
            </Tooltip>
            <strong>{index === 0 ? "You" : (player?.displayName ?? "Opponent")}</strong>
            {player?.forfeited && <span className="score-judging">Forfeited</span>}
            <Tooltip content="Best submission: cases passed">
              <span className="competitive-score" tabIndex={0}>
                {player?.bestScore ? `${player.bestScore.passed}/${player.bestScore.total}` : "—"}
              </span>
            </Tooltip>
            {(player?.submissionState === "running" || player?.submissionState === "queued") && (
              <span className="score-judging">Judging…</span>
            )}
          </div>
        ),
      )}
      <div className="competitive-clock-actions">
        {status !== "live" && (
          <Tooltip content="Connection interrupted; refreshing match state">
            <span className="sync-label">Reconnecting…</span>
          </Tooltip>
        )}
        {snapshot.state === "active" ? <MatchClock snapshot={snapshot} /> : null}
        {!own?.forfeited && (snapshot.state === "active" || snapshot.state === "finalizing") && (
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
  const { identity, account } = useAccountIdentity();
  const { preference, setPreference } = useTheme();
  const { snapshot, error, status, refetch } = useMatchSync(identity, matchId);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [conceding, setConceding] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (snapshot?.state === "completed" || snapshot?.state === "cancelled") setConceding(false);
  }, [snapshot?.state]);
  const [settings, setSettings] = useState<CreateMatchRequest>(defaultMatchSettings);
  const snapshotSettings = (match: MatchSnapshot): CreateMatchRequest => ({
    mode: match.mode,
    difficulties: match.difficulties ?? [match.difficulty],
    selectedProblemVersionId: match.selectedProblemVersionId,
    durationMinutes: match.durationMinutes,
    rules: match.rules,
  });
  useEffect(() => {
    if (snapshot) setSettings(snapshotSettings(snapshot));
  }, [snapshot?.version]);
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
  if (!account.isPending && !account.data)
    return (
      <main className="match-page">
        <GlobalNav identity={identity} theme={preference} onThemeChange={setPreference} />
        <section className="match-page-content">
          <h1>Sign in to join the match</h1>
          <a className="button button-primary" href="/login">
            Sign in
          </a>
        </section>
      </main>
    );
  if (!snapshot)
    return (
      <main className="match-page">
        <GlobalNav identity={identity} theme={preference} onThemeChange={setPreference} />
        <section className="match-page-content">
          <h1>{error ? "Match unavailable" : "Opening match…"}</h1>
          {error && (
            <>
              <p role="alert">{error instanceof Error ? error.message : String(error)}</p>
              <button className="button button-secondary" onClick={() => void refetch()}>
                Retry
              </button>
              <a className="text-link" href="/practice">
                Back to practice
              </a>
            </>
          )}
        </section>
      </main>
    );
  const own = ownParticipant(snapshot, identity);
  const mode = snapshot.mode === "free-for-all" ? freeForAll : showdown;
  const host = snapshot.hostUserId === participantUserId(identity);
  const started = ["active", "finalizing", "completed"].includes(snapshot.state);
  const ownWorkspaceId = started ? own?.workspaceId : undefined;
  const inviteUrl = readInvite(identity, matchId);
  const inviteOpponent = async () => {
    if (!inviteUrl || sharing) return;
    setSharing(true);
    setActionError(undefined);
    try {
      if ((await shareInvitation(inviteUrl)) === "copied") setCopied(true);
    } catch {
      setActionError("Sharing unavailable. Copy the invitation link instead.");
    } finally {
      setSharing(false);
    }
  };
  const copyInvitation = async () => {
    if (!inviteUrl) return;
    setActionError(undefined);
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setActionError("Copy unavailable. Select and copy the link.");
    }
  };
  const invitationActions = (
    <InvitationActions
      copied={copied}
      sharing={sharing}
      onCopy={() => void copyInvitation()}
      onShare={() => void inviteOpponent()}
    />
  );
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
      {!!snapshot.ruleEvents.length && (
        <div className="match-rule-announcements" role="log" aria-label="Lobby announcements">
          {snapshot.ruleEvents.map((event) => (
            <p key={event.id}>
              <Icon name="people" />
              <span>
                {snapshot.participants.find((player) => player.userId === event.userId)
                  ?.displayName ?? "Player"}{" "}
                {event.kind === "clipboard" ? "used copy / paste" : "left the match window"}
              </span>
              <time dateTime={event.occurredAt}>
                {new Date(event.occurredAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </p>
          ))}
        </div>
      )}
      {snapshot.state !== "active" && (
        <div
          className={`match-terminal competitive-outcome ${snapshot.outcome?.winnerUserId === participantUserId(identity) ? "is-winner" : ""}`}
          role="status"
        >
          <strong>{outcomeLabel(snapshot, identity)}</strong>
          <span>
            {snapshot.state === "finalizing"
              ? "Admitted submissions are still being judged. Scores settle before the final outcome."
              : snapshot.outcome?.reason.replaceAll("_", " ")}
          </span>
          <a href="/practice">Back to practice</a>
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
        matchHeader={ledger}
      />
    );
  const closed = snapshot.state === "cancelled" || snapshot.state === "completed";
  return (
    <main className="match-page">
      <GlobalNav
        identity={identity}
        mode={snapshot.mode}
        theme={preference}
        onThemeChange={setPreference}
      />
      <section className="match-page-content">
        <div className="competitive-lobby-heading">
          <div>
            <h1>
              {!closed && <ModeIcon mode={snapshot.mode} />}
              {closed ? outcomeLabel(snapshot, identity) : mode.name}
            </h1>
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
                    window.location.assign("/practice");
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
            <div
              className={`competitive-seats ${snapshot.mode === "free-for-all" ? "ffa-seats" : ""}`}
              aria-label="Players"
            >
              {snapshot.participants.map((participant) => (
                <div className="competitive-seat" key={participant.userId}>
                  <span className="participant-avatar">{participant.displayName.slice(0, 1)}</span>
                  <div>
                    <strong>
                      {participant.userId === participantUserId(identity)
                        ? `${participant.displayName} (you)`
                        : participant.displayName}
                    </strong>
                    <span>{participant.userId === snapshot.hostUserId ? "Host" : "Player"}</span>
                  </div>
                  <Tooltip content={participant.ready ? "Ready" : "Not ready"}>
                    <span
                      className={`seat-readiness ${participant.ready ? "is-ready" : ""}`}
                      role="img"
                      aria-label={participant.ready ? "Ready" : "Not ready"}
                      tabIndex={0}
                    >
                      <ReadinessIcon ready={participant.ready} />
                    </span>
                  </Tooltip>
                </div>
              ))}
              {snapshot.participants.length < (snapshot.mode === "free-for-all" ? 8 : 2) && (
                <div className="competitive-seat waiting-seat">
                  <span className="participant-avatar">
                    <Icon name="people" />
                  </span>
                  <div>
                    <strong>Open seat</strong>
                    <span>
                      {snapshot.mode === "free-for-all"
                        ? `${8 - snapshot.participants.length} seats available`
                        : "Invite your opponent"}
                    </span>
                  </div>
                  {inviteUrl && host && invitationActions}
                </div>
              )}
            </div>
            {host ? (
              <div className="competitive-lobby-settings">
                <MatchSettings
                  showHostRules
                  value={settings}
                  identity={identity}
                  participantCount={snapshot.participants.length}
                  disabled={pending}
                  onChange={(next) => {
                    if (JSON.stringify(next) === JSON.stringify(settings)) return;
                    setSettings(next);
                    void command(async () => {
                      try {
                        await updateMatchSettings(identity, matchId, next);
                      } catch (cause) {
                        setSettings(snapshotSettings(snapshot));
                        throw cause;
                      }
                    });
                  }}
                />
              </div>
            ) : (
              <div className="competitive-lobby-settings">
                <MatchSettings
                  showHostRules
                  value={snapshotSettings(snapshot)}
                  identity={identity}
                  participantCount={snapshot.participants.length}
                  disabled
                  onChange={() => {}}
                />
              </div>
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
                  {invitationActions}
                </div>
              </div>
            )}
            <footer className="competitive-lobby-footer">
              <span role="status">
                {status !== "live" ? "Reconnecting…" : lobbyWaitingLabel(snapshot, identity)}
              </span>
              <div className="lobby-ready-actions">
                <button
                  className={`button readiness-action ${own?.ready ? "button-secondary" : "button-primary"}`}
                  data-ready={!!own?.ready}
                  aria-label={own?.ready ? "Cancel" : "Ready"}
                  aria-busy={pending}
                  disabled={pending || !own}
                  onClick={() => void command(() => setReady(identity, matchId, !own?.ready))}
                >
                  <ReadyActionIcon ready={!!own?.ready} />
                  <span className="readiness-labels" aria-hidden="true">
                    <span className="readiness-option readiness-option-ready">Ready</span>
                    <span className="readiness-option readiness-option-cancel">Cancel</span>
                  </span>
                </button>
                {host && snapshot.mode === "free-for-all" && (
                  <button
                    className="button button-primary"
                    disabled={
                      pending ||
                      snapshot.participants.length < 2 ||
                      !snapshot.participants.every((player) => player.ready)
                    }
                    onClick={() => void command(() => startMatch(identity, matchId))}
                  >
                    <Icon name="play" />
                    Start
                  </button>
                )}
              </div>
            </footer>
          </>
        )}
        {(actionError || error) && (
          <p role="alert" className="result-error">
            {actionError ?? (error instanceof Error ? error.message : String(error))}
          </p>
        )}
        {closed && (
          <a className="text-link" href="/practice">
            Back to practice
          </a>
        )}
      </section>
    </main>
  );
}
