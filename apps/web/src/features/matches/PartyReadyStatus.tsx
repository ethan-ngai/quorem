/** @file PartyReadyStatus.tsx @description Shared lobby and results readiness feedback. @module matches */
import { useEffect, useState } from "react";
import { PersistentNotice } from "../../ui/PersistentNotice";
import type { PartyMember } from "@quorem/contracts";

export function PartyReadyStatus({
  members,
  countdownEndsAt,
  queueError,
}: {
  members: Pick<PartyMember, "displayName" | "ready" | "online">[];
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
  const ready = members.filter((member) => member.online && member.ready).length;
  const waiting = members
    .filter((member) => !member.online || !member.ready)
    .map((member) => member.displayName);
  const seconds = countdownEndsAt
    ? Math.max(0, Math.ceil((Date.parse(countdownEndsAt) - now) / 1000))
    : null;
  return (
    <div className="party-ready-feedback">
      <p className="party-ready-status" role="status">
        {seconds !== null && Number.isFinite(seconds)
          ? seconds === 0
            ? "Starting match…"
            : `Next match in ${seconds}s`
          : `${ready} / ${members.length} ready${waiting.length && waiting.length <= 2 ? ` · Waiting for ${waiting.join(", ")}` : ""}`}
      </p>
      <PersistentNotice message={queueError} label="Next match unavailable" />
    </div>
  );
}
