/** @file ScoreProgress.tsx @description Compact numeric score and identity-colored underline. @module ui */
import type { CSSProperties } from "react";
import type { Score } from "@quorem/contracts";
import "./score-progress.css";

export function ScoreProgress({ score, color }: { score?: Score; color: string }) {
  const ratio = score && score.total > 0 ? Math.min(1, Math.max(0, score.passed / score.total)) : 0;
  return (
    <span
      className="score-progress"
      role="img"
      aria-label={score ? `${score.passed} of ${score.total} cases passed` : "No score"}
      style={{ "--score-color": color, "--score-progress": `${ratio * 100}%` } as CSSProperties}
    >
      <span className="score-progress-number" aria-hidden="true">
        {score ? (
          <>
            {score.passed}
            <span className="score-progress-total"> / {score.total}</span>
          </>
        ) : (
          "—"
        )}
      </span>
      <span
        className="score-progress-track"
        data-unavailable={!score || score.total === 0}
        aria-hidden="true"
      >
        <span />
      </span>
    </span>
  );
}
