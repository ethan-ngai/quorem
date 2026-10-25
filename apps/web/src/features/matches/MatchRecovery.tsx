/** @file MatchRecovery.tsx @description Match-specific wording for shared workspace recovery. @module matches */
import { WorkspaceRecovery } from "../../ui/WorkspaceRecovery";
export function MatchRecovery({
  failed,
  onRetry,
}: {
  failed: boolean;
  onRetry: () => Promise<unknown>;
}) {
  return (
    <WorkspaceRecovery
      failed={failed}
      onRetry={onRetry}
      title={failed ? "Couldn't open this match" : "Opening match"}
      message={
        failed
          ? "We couldn't load the lobby. Try reconnecting, or head back to practice."
          : "Connecting to the lobby…"
      }
    />
  );
}
