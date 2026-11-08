/** @file PartyReadyStatus.tsx @description Shared per-member readiness and automatic-start feedback. @module matches */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, CircleDashed, LogOut, WifiOff } from "lucide-react";
import { ParticipantName } from "../collaboration/ParticipantName";
import { MatchWinnerMetadata } from "./MatchWinnerMetadata";
import { AnimatedRows } from "../../ui/AnimatedRows";
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
    <AnimatedRows
      as="ul"
      className={
        actions ? "party-ready-members party-ready-members-with-actions" : "party-ready-members"
      }
      rowClassName="action-reveal-group"
      label="Lobby readiness"
      items={members}
      getKey={(member) => member.userId}
      renderRow={(member) => (
        <>
          <span className="party-ready-person">
            <ParticipantName
              participant={member}
              self={member.userId === ownUserId}
              host={member.userId === hostUserId}
              nameSuffix={member.previousWinner && <MatchWinnerMetadata previous />}
            />
            <PartyReadinessIndicator member={member} />
          </span>
          {actions?.(member)}
        </>
      )}
    />
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
  return (
    <>
      {countdownEndsAt && (
        <PartyCountdown key={countdownEndsAt} deadline={countdownEndsAt} firstMatch={firstMatch} />
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

function PartyCountdown({ deadline, firstMatch }: { deadline: string; firstMatch: boolean }) {
  const endsAt = Date.parse(deadline);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!Number.isFinite(endsAt)) return;
    const timer = window.setInterval(() => {
      const sample = Date.now();
      setNow(sample);
      if (sample >= endsAt) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [endsAt]);
  const remaining = endsAt - now;
  if (!Number.isFinite(remaining)) return null;
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  const starting = seconds === 0;
  const matchLabel = firstMatch ? "Match" : "Next match";
  const title = firstMatch ? "Starting match" : "Starting next match";
  return (
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
      <PartyMemberReadiness members={joined} hostUserId={hostUserId} ownUserId={ownUserId} />
    </section>
  );
}
