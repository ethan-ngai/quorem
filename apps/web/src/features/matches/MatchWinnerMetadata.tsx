/** @file MatchWinnerMetadata.tsx @description Winner crown and actual round duration. @module matches */
import { Clock, Crown } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";

export function MatchWinnerMetadata({ elapsed }: { elapsed?: string }) {
  return (
    <span className="match-winner-metadata">
      <Tooltip content="Winner">
        <span className="match-winner-crown" role="img" aria-label="Winner" tabIndex={0}>
          <Crown size={14} aria-hidden="true" />
        </span>
      </Tooltip>
      {elapsed && (
        <span className="match-winner-time" aria-label={`Match duration ${elapsed}`}>
          <Clock size={14} aria-hidden="true" />
          <span>{elapsed}</span>
        </span>
      )}
    </span>
  );
}
