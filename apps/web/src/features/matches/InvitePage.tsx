/** @file InvitePage.tsx @description Read-only invitation preview with explicit account-aware acceptance. @module matches */
import * as Dialog from "@radix-ui/react-dialog";
import { createApiClient } from "@quorem/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useErrorNotification } from "../../ui/Notifications";
import { UserFacingError, userFacingErrorMessage } from "../../ui/errors";
import { requireData } from "../editor/api";
import { Icon } from "../editor/components/Icon";
import { GlobalNav } from "../navigation/GlobalNav";
import { useTheme } from "../editor/useTheme";
import { joinMatch } from "./api";
import { ModeIcon, useAccountIdentity } from "./MatchControls";
import "../../styles/workspace.css";

/** Invitation possession grants preview access; only explicit acceptance can claim a seat. */
export function InvitePage({ token }: { token: string }) {
  const { identity, account } = useAccountIdentity();
  const { preference, setPreference } = useTheme();
  const [pending, setPending] = useState(false);
  const [dismissedToken, setDismissedToken] = useState<string>();
  const [error, setError] = useState<string>();
  useErrorNotification(error);
  const preview = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: async ({ signal }) => {
      const { data, error, response } = await createApiClient({
        baseUrl: window.location.origin,
      }).GET("/v1/match-invites/{token}", { params: { path: { token } }, signal });
      if (response.status === 404)
        throw new UserFacingError("This invitation has expired or the lobby is unavailable.");
      return requireData(data, error);
    },
    retry: false,
    refetchInterval: 5000,
  });
  const lobby = preview.data;
  const full = !!lobby && lobby.participantCount >= lobby.capacity;
  const loginURL = `/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`;
  async function accept() {
    if (pending || !account.data || !lobby || full) return;
    setPending(true);
    setError(undefined);
    try {
      const snapshot = await joinMatch(identity, token);
      window.location.assign(`/match/${snapshot.id}`);
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "Could not join this lobby. Please try again."));
      setPending(false);
      void preview.refetch();
    }
  }
  return (
    <main className="match-page">
      <meta name="referrer" content="no-referrer" />
      <GlobalNav identity={identity} theme={preference} onThemeChange={setPreference} />
      <section className="match-page-content">
        {!lobby || preview.isError ? (
          <div className="invite-entry">
            <h1>{preview.isError ? "Invitation unavailable" : "Opening lobby…"}</h1>
            {preview.isError && (
              <>
                <p>
                  {userFacingErrorMessage(
                    preview.error,
                    "Could not load this lobby. Please try again.",
                  )}
                </p>
                <button className="button button-secondary" onClick={() => void preview.refetch()}>
                  Retry
                </button>
                <a className="text-link" href="/practice">
                  Back to practice
                </a>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="competitive-lobby-heading">
              <h1>
                <ModeIcon mode={lobby.mode} />
                {lobby.mode === "free-for-all" ? "Free-for-all" : "Showdown"}
              </h1>
            </div>
            <div className="competitive-seats invite-preview-seats" aria-label="Players">
              <div className="competitive-seat">
                <Icon name="people" />
                <div>
                  <strong>Players</strong>
                  <span>
                    {lobby.participantCount} of {lobby.capacity} seats filled
                  </span>
                </div>
              </div>
              <div className="competitive-seat">
                <div>
                  <strong>{full ? "Lobby full" : "Open seats"}</strong>
                  <span>{lobby.capacity - lobby.participantCount} available</span>
                </div>
              </div>
            </div>
            <dl className="competitive-lobby-summary">
              <div>
                <dt>Game mode</dt>
                <dd>{lobby.mode === "free-for-all" ? "Free-for-all" : "Showdown"}</dd>
              </div>
              <div>
                <dt>Difficulty</dt>
                <dd>{lobby.difficulties.join(", ")}</dd>
              </div>
              <div>
                <dt>Problem</dt>
                <dd className="invite-preview-problem">Revealed when the match starts</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{lobby.durationMinutes} minutes</dd>
              </div>
              <div>
                <dt>Copy / paste</dt>
                <dd>{lobby.rules.clipboard === "off" ? "Allow" : lobby.rules.clipboard}</dd>
              </div>
              <div>
                <dt>Leaving the window</dt>
                <dd>{lobby.rules.focus === "off" ? "Allow" : lobby.rules.focus}</dd>
              </div>
            </dl>
            <footer className="competitive-lobby-footer">
              <span>
                {full
                  ? "This lobby has no open seats."
                  : "Accept the invitation to join this lobby."}
              </span>
              {account.isError ? (
                <button className="button button-secondary" onClick={() => void account.refetch()}>
                  Retry account check
                </button>
              ) : (
                <button
                  className="button button-primary"
                  disabled={full || account.isPending}
                  id="invite-join"
                  onClick={() => setDismissedToken(undefined)}
                >
                  {account.isPending ? "Checking account…" : "Join lobby"}
                </button>
              )}
            </footer>
            <Dialog.Root
              open={account.isSuccess && dismissedToken !== token && !full && !preview.isError}
              onOpenChange={(open) => {
                if (!pending) setDismissedToken(open ? undefined : token);
              }}
            >
              <Dialog.Portal>
                <Dialog.Overlay className="settings-backdrop" />
                <Dialog.Content
                  className="competitive-dialog"
                  onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    document.getElementById("invite-join")?.focus();
                  }}
                >
                  <header className="competitive-dialog-heading">
                    <div>
                      <Dialog.Title>
                        {account.data ? "Join this lobby?" : "Sign in to join"}
                      </Dialog.Title>
                      <Dialog.Description>
                        {account.data
                          ? `Join as ${account.data.user.displayName}.`
                          : "This lobby requires an account. Sign in to join."}
                      </Dialog.Description>
                    </div>
                  </header>
                  <div className="competitive-dialog-actions">
                    <Dialog.Close asChild>
                      <button className="button button-secondary" disabled={pending}>
                        View lobby
                      </button>
                    </Dialog.Close>
                    {account.data ? (
                      <button
                        className="button button-primary"
                        disabled={pending}
                        onClick={() => void accept()}
                      >
                        {pending ? "Joining…" : "Join lobby"}
                      </button>
                    ) : (
                      <a className="button button-primary" href={loginURL}>
                        Sign in
                      </a>
                    )}
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </>
        )}
      </section>
    </main>
  );
}
