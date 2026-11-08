/** @file MatchCompletionActions.tsx @description Shared post-match navigation and quick readiness. @module matches */
import { FileCode2, Plus, RotateCcw, Users, X, Zap } from "lucide-react";
import { SpinnerSwap } from "../../ui/Spinner";

export function MatchCompletionActions({
  review,
  lobby,
  readiness,
}: {
  review?: { onClick: () => void; disabled: boolean };
  lobby?: "return" | "create";
  readiness?: {
    ready: boolean;
    pending: boolean;
    disabled: boolean;
    retry: boolean;
    onClick: () => void;
  };
}) {
  return (
    <div className="match-completion-actions">
      {review && (
        <button
          className="button button-secondary"
          onClick={review.onClick}
          disabled={review.disabled}
          title={review.disabled ? "Review is available after judging finishes." : undefined}
        >
          <FileCode2 size={16} aria-hidden="true" />
          Review code
        </button>
      )}
      {lobby === "return" && (
        <a className="button button-secondary" href="/party">
          <Users size={16} aria-hidden="true" />
          Return to lobby
        </a>
      )}
      {lobby === "create" && (
        <a
          className={`button button-primary${review ? "" : " match-completion-primary"}`}
          href="/practice?create=match"
        >
          <Plus size={16} aria-hidden="true" />
          Create lobby
        </a>
      )}
      {readiness && (
        <button
          className={`button match-completion-primary ${readiness.ready ? "button-secondary" : "button-primary"}`}
          disabled={readiness.disabled || readiness.pending}
          aria-busy={readiness.pending}
          onClick={readiness.onClick}
        >
          <SpinnerSwap pending={readiness.pending}>
            {readiness.retry ? (
              <RotateCcw size={16} />
            ) : readiness.ready ? (
              <X size={16} />
            ) : (
              <Zap size={16} />
            )}
          </SpinnerSwap>
          {readiness.retry ? "Retry readiness" : readiness.ready ? "Unready" : "Quick ready"}
        </button>
      )}
    </div>
  );
}
