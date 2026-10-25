/** @file WorkspaceRecovery.tsx @description Shared loading and reconnect presentation. @module ui */
import { ArrowLeft, RotateCcw, Unplug } from "lucide-react";
import { useId, useState } from "react";
import { LogoSpinner } from "./LoadingScreen";

export function WorkspaceRecovery({
  failed,
  title,
  message,
  onRetry,
  backHref = "/practice",
  backLabel = "Back to practice",
}: {
  failed: boolean;
  title: string;
  message: string;
  onRetry: () => Promise<unknown>;
  backHref?: string;
  backLabel?: string;
}) {
  const [retrying, setRetrying] = useState(false);
  const titleId = useId();
  return (
    <section className="match-recovery" aria-labelledby={titleId} aria-busy={!failed || retrying}>
      <div className="match-recovery-symbol" aria-hidden="true">
        {failed ? <Unplug /> : <LogoSpinner />}
      </div>
      <h1 id={titleId}>{title}</h1>
      <p role={failed ? "alert" : "status"}>{message}</p>
      {failed && (
        <div className="match-recovery-actions">
          <button
            className="button button-primary"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              try {
                await onRetry();
              } finally {
                setRetrying(false);
              }
            }}
          >
            <RotateCcw className={retrying ? "match-recovery-spinner" : undefined} />
            {retrying ? "Reconnecting…" : "Try again"}
          </button>
          <a className="button button-secondary" href={backHref}>
            <ArrowLeft />
            {backLabel}
          </a>
        </div>
      )}
    </section>
  );
}
