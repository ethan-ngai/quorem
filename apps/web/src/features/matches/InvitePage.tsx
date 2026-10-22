/** @file InvitePage.tsx @description Explicit private invitation acceptance. @module matches */
import { userFacingErrorMessage } from "../../ui/errors";
import { useState } from "react";
import { Icon } from "../editor/components/Icon";
import { GlobalNav } from "../navigation/GlobalNav";
import { useTheme } from "../editor/useTheme";
import { joinMatch } from "./api";
import { useAccountIdentity } from "./MatchControls";
import "../../styles/workspace.css";

/** @returns An invitation entry screen without exposing the problem. */
export function InvitePage({ token }: { token: string }) {
  const { identity, account } = useAccountIdentity();
  const { preference, setPreference } = useTheme();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <main className="match-page">
      <GlobalNav identity={identity} theme={preference} onThemeChange={setPreference} />
      <section className="match-page-content invite-entry">
        <div className="invite-symbol">
          <Icon name="people" />
        </div>
        <h1>Match invitation</h1>
        <p>Join the lobby to see its mode and rules.</p>
        {!account.isPending && !account.data ? (
          <a className="button button-primary" href="/login">
            Sign in to join
          </a>
        ) : (
          <button
            className="button button-primary"
            disabled={pending || account.isPending}
            onClick={async () => {
              setPending(true);
              setError(undefined);
              try {
                const snapshot = await joinMatch(identity, token);
                window.location.assign(`/match/${snapshot.id}`);
              } catch (cause) {
                setError(userFacingErrorMessage(cause, "Invitation unavailable."));
                setPending(false);
              }
            }}
          >
            {pending
              ? "Joining…"
              : account.isPending
                ? "Checking account…"
                : `Join as ${account.data?.user.displayName ?? "your account"}`}
            <Icon name="arrow" />
          </button>
        )}
        {error && (
          <p className="result-error" role="alert">
            {error}
          </p>
        )}
        <a className="text-link" href="/practice">
          Back to practice
        </a>
      </section>
    </main>
  );
}
