/** @file MatchWinnerMetadata.tsx @description Winner crown. @module matches */
import { Crown } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";

export function MatchWinnerMetadata() {
  return (
    <span className="match-winner-metadata">
      <Tooltip content="Winner">
        <span className="match-winner-crown" role="img" aria-label="Winner" tabIndex={0}>
          <Crown size={14} aria-hidden="true" />
        </span>
      </Tooltip>
    </span>
  );
}
