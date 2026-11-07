/** @file PartyReadyStatus.tsx @description Shared per-member readiness and automatic-start feedback. @module matches */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, CircleDashed, Crown, LogOut, WifiOff } from "lucide-react";
import { ParticipantName } from "../collaboration/ParticipantName";
import { MatchWinnerMetadata } from "./MatchWinnerMetadata";
import { StateIcon } from "../../ui/StateIcon";
import { Tooltip } from "../../ui/Tooltip";
import { PersistentNotice } from "../../ui/PersistentNotice";
import { PARTY_READY_COUNTDOWN_SECONDS, type PartyMember } from "@quorem/contracts";
import { MatchTimeRing } from "./MatchDurationRing";
import "./party-ready.css";

type ReadyMember = Pick<
  PartyMember,
  "userId" | "displayName" | "ready" | "online" | "image" | "color" | "previousWinner"
>;

export function PartyReadinessIndicator({
  member,
}: {
  member?: Pick<PartyMember, "ready" | "online">;
}) {
  const status = !member
    ? "Left lobby"
    : !member.online
      ? "Offline"
      : member.ready
        ? "Ready"
        : "Not ready";
  return (
    <Tooltip content={status}>
      <span className="party-readiness-indicator" role="img" aria-label={status} tabIndex={0}>
        {!member ? (
          <LogOut size={16} aria-hidden="true" />
        ) : !member.online ? (
          <WifiOff size={16} aria-hidden="true" />
        ) : (
          <StateIcon
            active={member.ready}
            on={<CircleCheck size={16} className="party-ready-check" />}
            off={<CircleDashed size={16} />}
          />
        )}
      </span>
    </Tooltip>
  );
}

export function PartyMemberReadiness({
  members,
  hostUserId,
  ownUserId,
  actions,
}: {
  members: ReadyMember[];
  hostUserId?: string;
  ownUserId?: string;
  actions?: (member: ReadyMember) => ReactNode;
}) {
  return (
    <ul
      className="party-ready-members"
      data-actions={actions ? true : undefined}
      aria-label="Lobby readiness"
    >
      {members.map((member) => (
        <li key={member.userId} className="action-reveal-group">
          <span className="party-ready-person">
            <ParticipantName
              participant={member}
              self={member.userId === ownUserId}
              nameSuffix={member.previousWinner && <MatchWinnerMetadata previous />}
              nameAdornment={
                hostUserId && member.userId === hostUserId ? (
                  <Tooltip content="Lobby host">
                    <span role="img" aria-label="Lobby host" tabIndex={0}>
                      <Crown size={12} aria-hidden="true" />
                    </span>
                  </Tooltip>
                ) : undefined
              }
            />
            <PartyReadinessIndicator member={member} />
          </span>
          {actions?.(member)}
        </li>
      ))}
    </ul>
  );
}

export function PartyReadyStatus({
  countdownEndsAt,
  queueError,
  firstMatch = false,
}: {
  countdownEndsAt: string | null;
  queueError?: string | null;
  firstMatch?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!countdownEndsAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => {
      const sample = Date.now();
      setNow(sample);
      if (sample >= Date.parse(countdownEndsAt)) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [countdownEndsAt]);
  const remaining = countdownEndsAt ? Date.parse(countdownEndsAt) - now : NaN;
  const counting = Number.isFinite(remaining);
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  const starting = seconds === 0;
  const matchLabel = firstMatch ? "Match" : "Next match";
  const title = firstMatch ? "Starting match" : "Starting next match";
  if (!counting && !queueError) return null;
  return (
    <>
      {counting && (
        <>
          <span className="sr-only" role="alert">
            {starting ? `${title}.` : `${matchLabel} starts shortly.`}
          </span>
          <span className="sr-only" role="timer">
            {starting ? `${title}…` : `${matchLabel} in ${seconds}s`}
          </span>
          {typeof document !== "undefined" &&
            createPortal(
              <div className="party-countdown-popup" aria-hidden="true">
                <span className="party-countdown-ring">
                  <MatchTimeRing fraction={remaining / (PARTY_READY_COUNTDOWN_SECONDS * 1000)} />
                  <span>{seconds}</span>
                </span>
                <span className="party-countdown-label">
                  {title}
                  {starting ? "…" : ""}
                </span>
              </div>,
              document.body,
            )}
        </>
      )}
      {queueError && (
        <div className="party-ready-feedback">
          <PersistentNotice
            message={queueError}
            label={firstMatch ? "Match unavailable" : "Next match unavailable"}
          />
        </div>
      )}
    </>
  );
}

export function MatchLobbyReadiness({
  members,
  participantIds,
  hostUserId,
  ownUserId,
}: {
  members: ReadyMember[];
  participantIds: readonly string[];
  hostUserId?: string;
  ownUserId?: string;
}) {
  const joined = members.filter((member) => !participantIds.includes(member.userId));
  const ready = members.filter((member) => member.online && member.ready).length;
  return (
    <section className="match-lobby-joined" aria-label="Next match readiness">
      <div className="party-ready-heading">
        {joined.length > 0 && <h3>Joined lobby</h3>}
        <span role="status">
          {ready} / {members.length} ready
        </span>
      </div>
      {joined.length > 0 && (
        <PartyMemberReadiness members={joined} hostUserId={hostUserId} ownUserId={ownUserId} />
      )}
    </section>
  );
}
