/** @file MatchSummaryMetadata.tsx @description Compact, accessible match facts with semantic difficulty coloring. @module matches */
import type { MatchSnapshot } from "@quorem/contracts";
import { DifficultyLabel } from "../../ui/DifficultyLabel";
import { Tooltip } from "../../ui/Tooltip";
import { ModeIcon } from "./ModeIcon";
import "./match-summary-metadata.css";

export function MatchSummaryMetadata({
  mode,
  difficulty,
}: Pick<MatchSnapshot, "mode" | "difficulty">) {
  const modeLabel = mode === "showdown" ? "Showdown" : "Free-for-all";
  return (
    <div className="match-summary-metadata" role="group" aria-label="Match settings">
      <Tooltip content={modeLabel}>
        <span className="match-summary-mode" role="img" aria-label={modeLabel} tabIndex={0}>
          <ModeIcon mode={mode} />
        </span>
      </Tooltip>
      <DifficultyLabel difficulty={difficulty} />
    </div>
  );
}
