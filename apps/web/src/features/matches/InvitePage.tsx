/** @file InvitePage.tsx @description Accept a persistent party invitation. @module matches */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { PartyInvitation } from "@quorem/contracts";
import { useAccountIdentity } from "./MatchControls";
import { partyCommand, partyRequest, useParty } from "./party";
import { GlobalNav } from "../navigation/GlobalNav";
import { useTheme } from "../editor/useTheme";
import { SignInRedirect } from "../auth/RouteAccess";
import { hasRouteSession, isRouteDenied } from "../auth/protectedRoute";
import { NotFoundPage } from "../public/NotFoundPage";
import { RouteError } from "../../ui/RouteError";
import { RejectedMatchCommand } from "./errors";

export function InvitePage({ token }: { token: string }) {
  const { identity, account } = useAccountIdentity();
  const { preference, setPreference } = useTheme();
  const current = useParty(identity, !!account.data);
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
    if (pending) return;
    setPending(true);
    setError("");
    try {
      if (account.data) await partyCommand(identity, "/v1/parties/join", "POST", { token });
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
      window.location.assign("/party");
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
    requiresAccount && (account.isPending || (account.data?.kind === "guest" && current.isPending));
  if (requiresAccount && account.isError)
    return <RouteError reset={() => void account.refetch()} />;
  if (requiresAccount && !checkingAccount && !hasRouteSession(account.data))
    return <SignInRedirect />;
  return (
    <main className="match-page">
      <GlobalNav identity={identity} theme={preference} onThemeChange={setPreference} />
      <section className="match-page-content">
        {invitation.isPending || checkingAccount ? (
          <p role="status">Opening invitation…</p>
        ) : !invitation.data ? (
          <>
            <h1>Invitation unavailable</h1>
            <p>This invitation may have expired.</p>
          </>
        ) : (
          <>
            <h1>Join lobby</h1>
            <p>
              {invitation.data.participantCount} of {invitation.data.capacity} seats filled
            </p>
            {error && <p role="alert">{error}</p>}
            {alreadyJoined ? (
              <a className="button button-primary" href="/party">
                Return to lobby
              </a>
            ) : account.data ? (
              <button
                className="button button-primary"
                disabled={pending}
                onClick={() => void join()}
              >
                {pending ? "Joining…" : "Join lobby"}
              </button>
            ) : (
              <>
                <a
                  className="button button-secondary"
                  href={`/login?returnTo=${encodeURIComponent(`/invite/${token}`)}`}
                >
                  Sign in
                </a>
                {invitation.data.guestAllowed && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void join();
                    }}
                  >
                    <label>
                      Guest name{" "}
                      <input
                        value={name}
                        maxLength={40}
                        onChange={(event) => setName(event.target.value)}
                        required
                      />
                    </label>
                    <button className="button button-primary" disabled={pending || !name.trim()}>
                      {pending ? "Joining…" : "Continue as guest"}
                    </button>
                  </form>
                )}
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}
