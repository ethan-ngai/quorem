/** @file InvitePage.tsx @description Accept a persistent party invitation. @module matches */
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { PartyInvitation } from "@quorem/contracts";
import { LobbySetupHeading, MatchSettings, useAccountIdentity } from "./MatchControls";
import { partyCommand, partyRequest, useParty } from "./party";
import { GlobalNav } from "../navigation/GlobalNav";
import { useTheme } from "../editor/useTheme";
import { SignInRedirect } from "../auth/RouteAccess";
import { hasRouteSession, isRouteDenied, signInRedirectOptions } from "../auth/protectedRoute";
import { NotFoundPage } from "../public/NotFoundPage";
import { RouteError } from "../../ui/RouteError";
import { RejectedMatchCommand } from "./errors";
import { InvitationLayout } from "../../ui/InvitationLayout";
import { SessionDialog } from "../../ui/SessionDialog";
import { TextInput } from "../../ui/TextControl";
import { PartyMemberReadiness } from "./PartyReadyStatus";

export function InvitePage({
  token,
  onJoined = () => window.location.assign("/party"),
}: {
  token: string;
  onJoined?: () => void;
}) {
  const { identity, account } = useAccountIdentity();
  const { preference, setPreference } = useTheme();
  const current = useParty(identity, !!account.data);
  const signedIn = hasRouteSession(account.data);
  const nameInput = useRef<HTMLInputElement>(null);
  const joinButton = useRef<HTMLButtonElement>(null);
  const [dismissed, setDismissed] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const invitation = useQuery({
    queryKey: ["party-invitation", token],
    retry: false,
    queryFn: () =>
      partyRequest<PartyInvitation>(`/v1/parties/invitations/${encodeURIComponent(token)}`),
  });
  const join = async () => {
    if (pending || (!signedIn && !name.trim())) return;
    setPending(true);
    setError("");
    try {
      if (signedIn) await partyCommand(identity, "/v1/parties/join", "POST", { token });
      else {
        const session = await fetch("/v1/guest-sessions", {
          method: "POST",
          credentials: "same-origin",
        });
        if (!session.ok) throw new Error("Guest unavailable");
        await partyCommand(
          identity,
          `/v1/parties/invitations/${encodeURIComponent(token)}/guest`,
          "POST",
          {
            name: name.trim(),
          },
        );
      }
      onJoined();
    } catch {
      setError("Could not join this lobby. Check the invitation and leave any other lobby first.");
      setPending(false);
    }
  };
  const status =
    invitation.error instanceof RejectedMatchCommand ? invitation.error.status : undefined;
  if (isRouteDenied(status)) return <NotFoundPage />;
  const alreadyJoined = !!invitation.data && current.data?.party?.id === invitation.data.id;
  const requiresAccount = invitation.data && !invitation.data.guestAllowed && !alreadyJoined;
  const checkingAccount =
    account.isPending || (account.data?.kind === "guest" && current.isPending);
  if (invitation.data && account.isError)
    return <RouteError reset={() => void account.refetch()} />;
  if (requiresAccount && !checkingAccount && !signedIn) return <SignInRedirect />;

  const guestEntry = invitation.data?.guestAllowed && !signedIn && !alreadyJoined;
  return (
    <InvitationLayout
      contentClassName="party-lobby"
      navigation={
        <GlobalNav identity={identity} theme={preference} onThemeChange={setPreference} />
      }
    >
      {invitation.isPending || checkingAccount ? (
        <p role="status">Opening invitation…</p>
      ) : !invitation.data ? (
        <>
          <h1>Invitation unavailable</h1>
          <p>This invitation may have expired.</p>
        </>
      ) : (
        <>
          <div className="lobby-command-lock">
            <div className="competitive-lobby-heading">
              <h1>Lobby</h1>
              {alreadyJoined ? (
                <a className="button button-primary" href="/party">
                  Return to lobby
                </a>
              ) : (
                <button
                  ref={joinButton}
                  className="button button-primary"
                  disabled={pending}
                  onClick={() => (guestEntry ? setDismissed(false) : void join())}
                >
                  {pending ? "Joining…" : "Join lobby"}
                </button>
              )}
            </div>
            <div className="lobby-roster">
              <PartyMemberReadiness
                members={Array.from({ length: invitation.data.participantCount }, (_, index) => ({
                  userId: `seat-${index}`,
                  displayName: `Player ${index + 1}`,
                }))}
              />
              <p className="invite-roster-count">
                {invitation.data.participantCount} of {invitation.data.capacity} seats filled
              </p>
            </div>
          </div>
          <MatchSettings
            value={invitation.data.matchSetup}
            identity={identity}
            participantCount={invitation.data.participantCount}
            heading={(options) => <LobbySetupHeading options={options} />}
          />
          {!guestEntry && error && <p role="alert">{error}</p>}
          {guestEntry && (
            <SessionDialog
              open={!dismissed}
              onOpenChange={(open) => setDismissed(!open)}
              pending={pending}
              title="Join lobby"
              description="Choose a name to display in the lobby."
              initialFocus={nameInput}
              returnFocus={() => joinButton.current?.focus()}
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void join();
                }}
              >
                <label className="guest-name-field">
                  Display name
                  <TextInput
                    ref={nameInput}
                    unstyled
                    required
                    maxLength={40}
                    autoComplete="nickname"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    readOnly={pending}
                  />
                </label>
                {error && <p role="alert">{error}</p>}
                <footer className="competitive-dialog-actions guest-entry-actions">
                  <a
                    className="button button-secondary"
                    href={signInRedirectOptions(`/invite/${token}`).href}
                    aria-disabled={pending || undefined}
                    onClick={(event) => {
                      if (pending) event.preventDefault();
                    }}
                  >
                    Log in
                  </a>
                  <button className="button button-primary" disabled={pending || !name.trim()}>
                    {pending ? "Joining…" : "Continue as guest"}
                  </button>
                </footer>
              </form>
            </SessionDialog>
          )}
        </>
      )}
    </InvitationLayout>
  );
}
