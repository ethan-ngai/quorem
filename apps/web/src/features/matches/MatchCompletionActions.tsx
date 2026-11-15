/** @file MatchCompletionActions.tsx @description Shared post-match navigation and quick readiness. @module matches */
import { LoadingButton } from "../../ui/LoadingButton";
import { FileSearch, Plus, RotateCcw, Users, X, Zap } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";

export function PlayerCodeReviewButton({ name, onClick }: { name: string; onClick: () => void }) {
  const label = `Review code for ${name}`;
  return (
    <Tooltip content={label}>
      <button type="button" className="icon-button" aria-label={label} onClick={onClick}>
        <FileSearch size={16} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

export function MatchCompletionActions({
  review,
  lobby,
  readiness,
}: {
  review?: { onClick: () => void; disabled: boolean; hasCode: boolean };
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
          {review.hasCode && <FileSearch size={16} aria-hidden="true" />}
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
        <LoadingButton
          className={`button match-completion-primary ${readiness.ready ? "button-secondary" : "button-primary"}`}
          disabled={readiness.disabled}
          onClick={readiness.onClick}
          icon={
            readiness.retry ? (
              <RotateCcw size={16} />
            ) : readiness.ready ? (
              <X size={16} />
            ) : (
              <Zap size={16} />
            )
          }
          pending={readiness.pending}
        >
          {readiness.retry ? "Retry readiness" : readiness.ready ? "Unready" : "Quick ready"}
        </LoadingButton>
      )}
    </div>
  );
}
