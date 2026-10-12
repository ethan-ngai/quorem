import type { CSSProperties } from "react";
import { usePreviewSequence } from "./usePreviewSequence";
const stages = ["Submission received", "Executing tests", "Comparing results", "Match complete"];
export default function SubmissionPreview() {
  const { root, stage, replay } = usePreviewSequence(3, false, 850);
  return (
    <div className="submission-demo" ref={root}>
      <div className="submission-top">
        <span>Two Sum</span>
        <span>Showdown</span>
      </div>
      <div className="judge-pipeline">
        {["Received", "Judging", "Result"].map((label, i) => (
          <div key={label} className={stage > i ? "complete" : stage === i ? "active" : ""}>
            <span>{stage > i ? "✓" : String(i + 1).padStart(2, "0")}</span>
            <small>{label}</small>
          </div>
        ))}
      </div>
      <div className="submission-contestants">
        {[
          { name: "Alex", passed: 14 },
          { name: "Jamie", passed: 20 },
        ].map(({ name, passed }) => (
          <div className="submission-contestant" key={name}>
            <div>
              <span className="product-avatar">{name[0]}</span>
              <strong>{name}</strong>
              <span>{stage < 2 ? "Judging…" : `${passed} / 20`}</span>
            </div>
            <div className="submission-test-grid">
              {Array.from({ length: 20 }, (_, i) => (
                <span
                  key={i}
                  style={{ "--test-index": i } as CSSProperties}
                  className={
                    stage >= 2 ? (i < passed ? "passed" : "failed") : stage === 1 ? "pending" : ""
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className={`submission-outcome ${stage === 3 ? "settled" : ""}`} aria-live="polite">
        <span>{stage === 3 ? "✓" : "·"}</span>
        <div>
          <strong>{stage === 3 ? "Jamie wins" : stages[stage]}</strong>
          <small>
            {stage === 3 ? "First correct submission" : "Each submission is judged independently"}
          </small>
        </div>
      </div>
      <button className="submission-replay" type="button" onClick={replay} disabled={stage < 3}>
        {stage === 3 ? "↻ Replay submission" : "Judging submissions…"}
      </button>
    </div>
  );
}
