/** @file InvitePage.tsx @description Explicit private invitation acceptance. @module matches */
import { useState } from "react";
import { Brand, Icon } from "../editor/components/Icon";
import { useTheme } from "../editor/useTheme";
import { joinMatch } from "./api";
import { IdentityChoice, useLocalIdentity } from "./MatchControls";
import "../../styles/workspace.css";

/** @returns An invitation entry screen without exposing the problem. */
export function InvitePage({ token }: { token: string }) {
  const { identity, setIdentity } = useLocalIdentity();
  useTheme();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  let existingMatch: string | null = null;
  try {
    existingMatch = localStorage.getItem(`quorem.last-match.v1:${identity}`);
  } catch {
    /* Storage may be unavailable. */
  }
  return (
    <main className="match-page">
      <header className="topbar">
        <Brand />
        <div className="topbar-spacer" />
        <IdentityChoice identity={identity} onChange={setIdentity} disabled={pending} />
      </header>
      <section className="match-page-content invite-entry">
        <div className="invite-symbol">
          <Icon name="people" />
        </div>
        <h1>Match invitation</h1>
        <p>
          Join the lobby to meet your opponent. The problem appears when both players are ready.
        </p>
        <button
          className="button button-primary"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError(undefined);
            try {
              const snapshot = await joinMatch(identity, token);
              window.location.assign(`/matches/${snapshot.id}`);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Invitation unavailable.");
              setPending(false);
            }
          }}
        >
          {pending ? "Joining…" : `Join as ${identity === "alice" ? "Alice" : "Bob"}`}
          <Icon name="arrow" />
        </button>
        {error && (
          <p className="result-error" role="alert">
            {error}
          </p>
        )}
        {error && existingMatch && (
          <a className="text-link" href={`/matches/${existingMatch}`}>
            Open existing match
          </a>
        )}
        <a className="text-link" href="/run-widths">
          Back to practice
        </a>
      </section>
    </main>
  );
}
