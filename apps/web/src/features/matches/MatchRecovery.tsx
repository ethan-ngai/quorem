import { ArrowLeft, LoaderCircle, RotateCcw, Unplug } from "lucide-react";
import { useState } from "react";

export function MatchRecovery({
  failed,
  onRetry,
}: {
  failed: boolean;
  onRetry: () => Promise<unknown>;
}) {
  const [retrying, setRetrying] = useState(false);
  return (
    <section
      className="match-recovery"
      aria-labelledby="match-recovery-title"
      aria-busy={!failed || retrying}
    >
      <div className="match-recovery-symbol" aria-hidden="true">
        {failed ? <Unplug /> : <LoaderCircle className="match-recovery-spinner" />}
      </div>
      <h1 id="match-recovery-title">{failed ? "Couldn't open this match" : "Opening match"}</h1>
      <p role={failed ? "alert" : "status"}>
        {failed
          ? "We couldn't load the lobby. Try reconnecting, or head back to practice."
          : "Connecting to the lobby…"}
      </p>
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
          <a className="button button-secondary" href="/practice">
            <ArrowLeft />
            Back to practice
          </a>
        </div>
      )}
    </section>
  );
}
