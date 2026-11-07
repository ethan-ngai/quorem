/** @file PartyReadyStatus.tsx @description Shared per-member readiness and automatic-start feedback. @module matches */
import { useEffect, useState, type ReactNode } from "react";
import { CircleCheck, CircleDashed, Crown, LogOut, WifiOff } from "lucide-react";
import { ParticipantName } from "../collaboration/ParticipantName";
import { MatchWinnerMetadata } from "./MatchWinnerMetadata";
import { Tooltip } from "../../ui/Tooltip";
import { PersistentNotice } from "../../ui/PersistentNotice";
import type { PartyMember } from "@quorem/contracts";
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
      <span
        className="party-readiness-indicator"
        data-ready={!!member?.online && member.ready}
        role="img"
        aria-label={status}
        tabIndex={0}
      >
        {!member ? (
          <LogOut size={16} aria-hidden="true" />
        ) : !member.online ? (
          <WifiOff size={16} aria-hidden="true" />
        ) : member.ready ? (
          <CircleCheck size={16} className="party-ready-check" aria-hidden="true" />
        ) : (
          <CircleDashed size={16} aria-hidden="true" />
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
          {actions?.(member)}
        </li>
      ))}
    </ul>
  );
}

export function PartyReadyStatus({
  countdownEndsAt,
  queueError,
}: {
  countdownEndsAt: string | null;
  queueError?: string | null;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!countdownEndsAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [countdownEndsAt]);
  const seconds = countdownEndsAt
    ? Math.max(0, Math.ceil((Date.parse(countdownEndsAt) - now) / 1000))
    : null;
  const counting = seconds !== null && Number.isFinite(seconds);
  if (!counting && !queueError) return null;
  return (
    <div className="party-ready-feedback">
      {counting && (
        <p className="party-ready-status" role="status">
          {seconds === 0 ? "Starting match…" : `Next match in ${seconds}s`}
        </p>
      )}
      <PersistentNotice message={queueError} label="Next match unavailable" />
    </div>
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
