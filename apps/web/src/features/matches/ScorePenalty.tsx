/** @file ScorePenalty.tsx @description Shared penalty badge for live and final standings. @module matches */
import { Clock3, Trophy } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import { formatPenaltyDuration } from "./matchTime";

/** @returns A compact penalty total with its effect available on focus or hover. */
export function ScorePenalty({ value, unit }: { value: number; unit: "seconds" | "points" }) {
  const time = unit === "seconds";
  const duration = time ? formatPenaltyDuration(value) : "";
  const label = time
    ? `Submission cutoff is ${duration} before the scheduled end`
    : `${value} ${value === 1 ? "point" : "points"} deducted from score`;
  return (
    <Tooltip content={label}>
      <span className="score-penalty" role="img" aria-label={label} tabIndex={0}>
        {time ? <Clock3 size={12} aria-hidden="true" /> : <Trophy size={12} aria-hidden="true" />}−
        {time ? duration : `${value} pt${value === 1 ? "" : "s"}`}
      </span>
    </Tooltip>
  );
}
