/** @file PartyReadyStatus.tsx @description Shared per-member readiness and automatic-start feedback. @module matches */
import { useEffect, useState } from "react";
import { Check, Circle, Crown, LogOut, WifiOff } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import { PersistentNotice } from "../../ui/PersistentNotice";
import type { PartyMember } from "@quorem/contracts";
import "./party-ready.css";

type ReadyMember = Pick<PartyMember, "displayName" | "ready" | "online"> &
  Partial<Pick<PartyMember, "userId">>;

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
          <Check size={16} aria-hidden="true" />
        ) : (
          <Circle size={16} aria-hidden="true" />
        )}
      </span>
    </Tooltip>
  );
}

export function PartyMemberReadiness({
  members,
  hostUserId,
}: {
  members: ReadyMember[];
  hostUserId?: string;
}) {
  return (
    <ul className="party-ready-members" aria-label="Lobby readiness">
      {members.map((member, index) => (
        <li key={member.userId ?? index}>
          <span className="party-ready-name">{member.displayName}</span>
          {hostUserId && member.userId === hostUserId && (
            <Tooltip content="Host">
              <span role="img" aria-label="Host" tabIndex={0}>
                <Crown size={14} aria-hidden="true" />
              </span>
            </Tooltip>
          )}
          <PartyReadinessIndicator member={member} />
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
