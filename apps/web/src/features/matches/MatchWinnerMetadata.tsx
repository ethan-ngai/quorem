/** @file MatchWinnerMetadata.tsx @description Winner trophy for lobby and results. @module matches */
import { Trophy } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import "./match-winner-metadata.css";

export function MatchWinnerMetadata({ previous = false }: { previous?: boolean }) {
  const label = previous ? "Previous match winner" : "Winner";
  return (
    <Tooltip content={label}>
      <span
        className="match-winner-trophy motion-reveal"
        role="img"
        aria-label={label}
        tabIndex={0}
      >
        <Trophy size={14} aria-hidden="true" />
      </span>
    </Tooltip>
  );
}
