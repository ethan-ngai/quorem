import { usePreviewSequence } from "./usePreviewSequence";
import { Icon } from "../../../web/src/features/editor/components/Icon";

/** Two independent submissions resolve into the first correct winner, once. */
export default function SubmissionPreview() {
  const { root, stage } = usePreviewSequence(4, true, 1100);
  return (
    <div
      className="submission-race workspace-demo"
      ref={root}
      data-stage={stage}
      role="img"
      aria-label="Example submissions: your solution passes fourteen tests; Jamie passes all twenty and wins with the first correct submission."
    >
      <div className="race-timeline" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className={`race-receipt ${stage >= 1 ? "received" : ""}`}>
        <div className="race-player">
          <span className="product-avatar">Y</span>
          <strong>You</strong>
          <small>{stage >= 2 ? "14 / 20" : "Submitting…"}</small>
        </div>
        <div className="race-checks">
          {Array.from({ length: 20 }, (_, i) => (
            <span key={i} className={stage >= 2 ? (i < 14 ? "passed" : "failed") : "pending"} />
          ))}
        </div>
        <p data-failed={stage >= 2}>
          {stage >= 2 ? (
            <>
              <Icon name="close" />
              Wrong answer
            </>
          ) : (
            <>
              <span className="case-spinner" />
              Judging solution
            </>
          )}
        </p>
      </div>
      <div className={`race-receipt race-correct ${stage >= 3 ? "received" : ""}`}>
        <div className="race-player">
          <span className="product-avatar">J</span>
          <strong>Jamie</strong>
          <small>{stage >= 4 ? "20 / 20" : "Submitting…"}</small>
        </div>
        <div className="race-checks">
          {Array.from({ length: 20 }, (_, i) => (
            <span key={i} className={stage >= 4 ? "passed" : "pending"} />
          ))}
        </div>
        <p>
          {stage >= 4 ? (
            <>
              <Icon name="submit" />
              Accepted
            </>
          ) : (
            <>
              <span className="case-spinner" />
              Judging solution
            </>
          )}
        </p>
      </div>
      <div className={`race-winner ${stage === 4 ? "visible" : ""}`}>
        <span className="race-winner-mark">
          <Icon name="showdown" />
        </span>
        <strong>Jamie wins</strong>
        <span>First correct submission</span>
      </div>
    </div>
  );
}
