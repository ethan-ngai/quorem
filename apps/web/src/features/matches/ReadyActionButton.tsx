import { LoaderCircle } from "lucide-react";
import { ReadyActionIcon } from "./ReadyActionIcon";

export function ReadyActionButton({
  ready,
  pending,
  disabled,
  onClick,
}: {
  ready: boolean;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`button readiness-action ${ready ? "button-secondary" : "button-primary"}`}
      data-ready={ready}
      aria-label={
        pending ? (ready ? "Cancelling readiness" : "Getting ready") : ready ? "Cancel" : "Ready"
      }
      aria-busy={pending}
      disabled={disabled || pending}
      onClick={onClick}
    >
      {pending ? (
        <LoaderCircle size={16} className="readiness-spinner" aria-hidden="true" />
      ) : (
        <ReadyActionIcon ready={ready} />
      )}
      {!pending && (
        <span className="readiness-labels" aria-hidden="true">
          <span className="readiness-option readiness-option-ready">Ready</span>
          <span className="readiness-option readiness-option-cancel">Cancel</span>
        </span>
      )}
    </button>
  );
}
