/** @file MatchSummaryMetadata.tsx @description Compact, accessible match facts with semantic difficulty coloring. @module matches */
import type { MatchSnapshot } from "@quorem/contracts";
import { Clock } from "lucide-react";
import { DifficultyLabel } from "../../ui/DifficultyLabel";
import { Tooltip } from "../../ui/Tooltip";
import { ModeIcon } from "./ModeIcon";
import "./match-summary-metadata.css";

export function MatchSummaryMetadata({
  mode,
  durationMinutes,
  difficulty,
}: Pick<MatchSnapshot, "mode" | "durationMinutes" | "difficulty">) {
  const modeLabel = mode === "showdown" ? "Showdown" : "Free-for-all";
  return (
    <div className="match-summary-metadata" role="group" aria-label="Match settings">
      <Tooltip content={modeLabel}>
        <span className="match-summary-mode" role="img" aria-label={modeLabel} tabIndex={0}>
          <ModeIcon mode={mode} />
        </span>
      </Tooltip>
      <span className="match-summary-duration" aria-label={`${durationMinutes}-minute time limit`}>
        <Clock size={16} aria-hidden="true" />
        <span>{durationMinutes} min</span>
      </span>
      <DifficultyLabel difficulty={difficulty} />
    </div>
  );
}
