/** @file MatchDurationRing.tsx @description Compact elapsed fraction, with the time limit on demand. @module matches */
import { Clock } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import { formatRoundTime } from "./matchTime";
import "./match-duration-ring.css";

export function MatchDurationRing({
  durationMinutes,
  elapsedSeconds,
}: {
  durationMinutes: number;
  elapsedSeconds?: number;
}) {
  const elapsed =
    elapsedSeconds !== undefined && Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0
      ? elapsedSeconds
      : undefined;
  const label =
    elapsed === undefined
      ? `${durationMinutes}-minute time limit`
      : `${formatRoundTime(elapsed)} elapsed of ${formatRoundTime(durationMinutes * 60)} allowed`;
  const fraction = elapsed === undefined ? 0 : Math.min(1, elapsed / (durationMinutes * 60));
  return (
    <Tooltip content={label}>
      <span className="match-duration" role="img" tabIndex={0} aria-label={label}>
        {elapsed === undefined ? (
          <Clock size={16} aria-hidden="true" />
        ) : (
          <>
            <span className="match-duration-ring" aria-hidden="true">
              <MatchTimeRing fraction={fraction} />
              <Clock className="match-duration-clock" size={16} />
            </span>
            <span className="match-duration-value" aria-hidden="true">
              {formatRoundTime(elapsed)}
            </span>
          </>
        )}
      </span>
    </Tooltip>
  );
}

/** @returns The shared visual track and bounded progress stroke for a match timer. */
export function MatchTimeRing({ fraction }: { fraction: number }) {
  return (
    <svg className="match-duration-track-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="match-duration-track" cx="12" cy="12" r="10" strokeWidth="2" />
      <circle
        className="match-duration-fill"
        cx="12"
        cy="12"
        r="10"
        strokeWidth="2"
        pathLength="1"
        strokeDasharray={`${Math.max(0, Math.min(1, fraction))} 1`}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}
