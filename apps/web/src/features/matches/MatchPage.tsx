import { matchCompetitors, isMatchWinner } from "./competitors";
import { FactionWorkspace } from "../factions/FactionWorkspace";
import { RoomAlerts } from "../rooms/RoomAlerts";
import { ParticipantName } from "../collaboration/ParticipantName";
import { ScoreProgress } from "../../ui/ScoreProgress";
import { participantColor } from "../collaboration/participantColor";
import { SessionBar } from "../../ui/SessionBar";
import { Clock3, Trophy } from "lucide-react";
/** @file MatchPage.tsx @description Match ledger and owner-scoped editor entry. @module matches */
import { MatchRecovery } from "./MatchRecovery";
import { MatchEndView } from "./MatchEndView";
import { useErrorNotification } from "../../ui/Notifications";
import { userFacingErrorMessage } from "../../ui/errors";
import {
  participantUserId,
  type DevelopmentIdentity,
  type MatchSnapshot,
  type ProblemVersion,
} from "@quorem/contracts";
import { useEffect, useRef, useState } from "react";
import { WorkspacePage } from "../editor/WorkspacePage";
import { Tooltip } from "../../ui/Tooltip";
import { Icon } from "../../ui/Icon";
import { useTheme } from "../editor/useTheme";
import { useMatchSync } from "../realtime/useMatchSync";
import { forfeitMatch } from "./api";
import { useAccountIdentity } from "./MatchControls";
import { ConcessionDialog } from "./ConcessionDialog";
import { formatPenaltyDuration } from "./matchTime";
import { outcomeLabel, ownParticipant, remainingTime } from "./matchState";
import { GlobalNav } from "../navigation/GlobalNav";
import "../../styles/workspace.css";

/** @returns A deadline clock anchored to each authoritative server snapshot. */
function MatchClock({ snapshot, active }: { snapshot: MatchSnapshot; active: boolean }) {
  const received = useRef({ version: snapshot.serverNow, at: Date.now() });
  const frozen = useRef<string | undefined>(undefined);
  if (active && received.current.version !== snapshot.serverNow)
    received.current = { version: snapshot.serverNow, at: Date.now() };
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  const remaining = active
    ? remainingTime(snapshot.deadline, snapshot.serverNow, Math.max(0, now - received.current.at))
    : (frozen.current ??= remainingTime(
        snapshot.deadline,
        snapshot.state === "finalizing"
          ? (snapshot.deadline ?? snapshot.serverNow)
          : (snapshot.outcome?.completedAt ?? snapshot.serverNow),
        0,
      ));
  return (
    <span className="match-clock">
      <Icon name="clock" />
      {remaining}
    </span>
  );
}

/** @returns A compact penalty total with its effect available on focus or hover. */
function ScorePenalty({ value, unit }: { value: number; unit: "seconds" | "points" }) {
  const time = unit === "seconds";
  const duration = time ? formatPenaltyDuration(value) : "";
  const label = time
    ? `${duration} added to finish time`
    : `${value} ${value === 1 ? "point" : "points"} deducted from score`;
  return (
    <Tooltip content={label}>
      <span className="score-penalty" role="img" aria-label={label} tabIndex={0}>
        {time ? <Clock3 size={12} aria-hidden="true" /> : <Trophy size={12} aria-hidden="true" />}
        {time ? `+${duration}` : `−${value} pt${value === 1 ? "" : "s"}`}
      </span>
    </Tooltip>
  );
}

/** @returns Safe participant scores and connection state, never source or private cases. */
function MatchLedger({
  snapshot,
  identity,
  status,
  onForfeit,
  onResults,
}: {
  snapshot: MatchSnapshot;
  identity: DevelopmentIdentity;
  status: string;
  onForfeit: () => void;
  onResults?: () => void;
}) {
  const own = ownParticipant(snapshot, identity);
  const competitors = matchCompetitors(snapshot).sort(
    (a, b) =>
      Number(snapshot.mode === "factions" ? b.team === own?.team : b.userId === own?.userId) -
      Number(snapshot.mode === "factions" ? a.team === own?.team : a.userId === own?.userId),
  );
  return (
    <SessionBar
      label="Match progress"
      onResults={onResults}
      actions={
        <>
          <RoomAlerts
            scope={`match:${snapshot.id}:${identity}`}
            version={BigInt(snapshot.version)}
            label="Match alerts"
            events={snapshot.ruleEvents.map((event) => ({
              ...event,
              name:
                snapshot.participants.find((player) => player.userId === event.userId)
                  ?.displayName ?? "Player",
              kind: event.kind === "clipboard" ? "paste" : event.kind,
              description: {
                clipboard: "pasted",
                copy: "copied",
                focus: "left the match window",
                topics: "revealed topics",
                complexity: "revealed complexity",
                hiddenCase: "revealed a hidden case",
                submission: "exceeded the submission allowance",
              }[event.kind],
            }))}
          />
          {status !== "live" && snapshot.state === "active" && !own?.forfeited && (
            <Tooltip content="Connection interrupted; refreshing match state">
              <span className="sync-label">Reconnecting…</span>
            </Tooltip>
          )}
          {snapshot.startedAt && (
            <MatchClock
              snapshot={snapshot}
              active={snapshot.state === "active" && !own?.forfeited}
            />
          )}
          {!own?.forfeited && snapshot.state === "active" && snapshot.mode !== "factions" && (
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
        </>
      }
    >
      {competitors.map((player, index) => (
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
          <strong>
            {snapshot.mode === "factions" ? (
              <Tooltip content={player.members.map((member) => member.displayName).join(", ")}>
                <span>{player.displayName}</span>
              </Tooltip>
            ) : (
              <ParticipantName participant={player} self={index === 0} />
            )}
          </strong>
          {player?.forfeited && <span className="score-judging motion-reveal">Forfeited</span>}
          <ScoreProgress
            score={player?.bestScore}
            color={participantColor(player?.userId ?? "opponent", player?.color)}
          />
          {snapshot.rules.victory === "high_score" && (
            <span className="score-judging">
              {Math.round((player?.adjustedScore ?? 0) * 100) / 100} points
            </span>
          )}
          {!!player?.penaltySeconds && (
            <ScorePenalty unit="seconds" value={player.penaltySeconds} />
          )}
          {!!player?.penaltyPoints && <ScorePenalty unit="points" value={player.penaltyPoints} />}
          {player?.eligibleFinishAt && snapshot.state === "active" && (
            <span className="score-judging">
              Eligible {new Date(player.eligibleFinishAt).toLocaleTimeString()}
            </span>
          )}
          {(player?.submissionState === "running" || player?.submissionState === "queued") && (
            <span className="score-judging motion-reveal">Judging…</span>
          )}
        </div>
      ))}
    </SessionBar>
  );
}

/** @returns A fully authoritative match route, revealing the problem only after start. */
export function MatchPage({
  matchId,
  reviewEntry = false,
}: {
  matchId: string;
  reviewEntry?: boolean;
}) {
  const { identity, account } = useAccountIdentity();
  const { preference, setPreference } = useTheme();
  const { snapshot, error, status, refetch } = useMatchSync(identity, matchId, true);
  const finished =
    snapshot &&
    account.data &&
    (snapshot.state === "completed" ||
      snapshot.state === "cancelled" ||
      ownParticipant(snapshot, identity)?.forfeited)
      ? { snapshot, identity }
      : undefined;
  const [resultsOpen, setResultsOpen] = useState(!reviewEntry);
  const [reviewing, setReviewing] = useState(reviewEntry);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  useErrorNotification(actionError);
  useErrorNotification(
    snapshot && error ? "Connection interrupted. Refreshing match state." : undefined,
  );
  const [conceding, setConceding] = useState(false);
  useEffect(() => {
    if (snapshot?.state === "completed" || snapshot?.state === "cancelled") setConceding(false);
  }, [snapshot?.state]);
  useEffect(() => {
    if (snapshot?.partyId && (snapshot.state === "waiting" || snapshot.state === "ready"))
      window.location.assign("/party");
  }, [snapshot?.partyId, snapshot?.state]);
  const command = async (
    action: () => Promise<unknown>,
    fallback = "Could not update the match. Try again.",
  ) => {
    if (pending) return;
    setPending(true);
    setActionError(undefined);
    try {
      await action();
      await refetch();
    } catch (cause) {
      setActionError(userFacingErrorMessage(cause, fallback));
    } finally {
      setPending(false);
    }
  };
  if (!account.isPending && !account.data && !finished)
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
        <MatchRecovery failed={!!error} onRetry={refetch} />
      </main>
    );
  const own = ownParticipant(snapshot, identity);
  const ownWorkspaceId = snapshot.startedAt ? own?.workspaceId : undefined;
  const concession = (
    <ConcessionDialog
      open={conceding}
      pending={pending}
      freeForAll={snapshot.mode === "free-for-all"}
      remainingPlayers={
        snapshot.participants.filter(
          (player) => !player.forfeited && player.userId !== participantUserId(identity),
        ).length
      }
      onCancel={() => setConceding(false)}
      onConfirm={() =>
        void command(async () => {
          await forfeitMatch(identity, matchId);
          setConceding(false);
        })
      }
    />
  );
  const ledger = (problem?: ProblemVersion) => (
    <>
      <MatchLedger
        snapshot={snapshot}
        identity={identity}
        status={status}
        onForfeit={() => setConceding(true)}
        onResults={finished ? () => setResultsOpen(true) : undefined}
      />
      {snapshot.state === "finalizing" && (
        <div
          className={`match-terminal competitive-outcome ${isMatchWinner(snapshot, ownParticipant(snapshot, identity)) ? "is-winner" : ""}`}
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

      {concession}
      {finished && (
        <MatchEndView
          snapshot={finished.snapshot}
          problemTitle={problem?.title}
          identity={finished.identity}
          open={resultsOpen}
          onOpenChange={setResultsOpen}
          onReview={() => {
            setResultsOpen(false);
            setReviewing(true);
          }}
        />
      )}
    </>
  );
  if (snapshot.mode === "factions" && ownWorkspaceId && !reviewing)
    return <FactionWorkspace match={snapshot} identity={identity} header={ledger} />;
  if (ownWorkspaceId && snapshot.problemVersionId)
    return (
      <WorkspacePage
        match={snapshot}
        matchWorkspaceId={ownWorkspaceId}
        identity={identity}
        matchHeader={ledger}
        review={reviewing && !!finished}
      />
    );
  return (
    <main className="match-page">
      <GlobalNav identity={identity} theme={preference} onThemeChange={setPreference} />
      <section className="match-page-content">
        {snapshot.state === "waiting" || snapshot.state === "ready" ? (
          <>
            <h1>Lobby unavailable</h1>
            <p>
              {snapshot.partyId ? "Returning to your lobby…" : "This lobby is no longer available."}
            </p>
            <a href={snapshot.partyId ? "/party" : "/practice"}>
              {snapshot.partyId ? "Return to lobby" : "Back to practice"}
            </a>
          </>
        ) : (
          <>
            <h1>Workspace unavailable</h1>
            <p>Could not load your match workspace.</p>
            <button className="button button-secondary" onClick={() => void refetch()}>
              Try again
            </button>
            {ledger()}
          </>
        )}
      </section>
    </main>
  );
}
