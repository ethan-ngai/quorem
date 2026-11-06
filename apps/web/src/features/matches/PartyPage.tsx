/** @file PartyPage.tsx @description Persistent lobby and shared readiness controls. @module matches */
import { participantUserId } from "@quorem/contracts";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { useAccountIdentity, MatchSettings } from "./MatchControls";
import { partyCommand, useParty, type PartySettings } from "./party";
import { PartyReadyStatus, PartyMemberReadiness } from "./PartyReadyStatus";
import { useActiveMatch } from "./useActiveMatch";
import { useTheme } from "../editor/useTheme";
import { GlobalNav } from "../navigation/GlobalNav";
import { readPendingCommand } from "./commandRecovery";
import { SessionDialog } from "../../ui/SessionDialog";
import { ToggleSwitch } from "../../ui/ToggleSwitch";

export function PartyPage() {
  const { identity, account } = useAccountIdentity();
  const { preference, setPreference } = useTheme();
  const query = useParty(identity, !!account.data);
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [disbanding, setDisbanding] = useState(false);
  const [error, setError] = useState("");
  const [, setRecoveryRevision] = useState(0);
  const party = query.data?.party;
  const activeMatch = useActiveMatch(identity, !!party?.currentMatchId);
  const latest = useQuery({
    queryKey: ["party-latest-match", identity, party?.latestMatchId],
    enabled: !!party?.latestMatchId,
    retry: false,
    refetchInterval: (query) => (query.state.data?.reviewPending ? 3000 : false),
    queryFn: async () => {
      const { data, error } = await api(identity).GET("/v1/matches/{id}", {
        params: { path: { id: party!.latestMatchId! } },
      });
      return requireData(data, error);
    },
  });
  const recovery =
    party &&
    ["settings", "ready", "start", "leave", "disband"]
      .map((operation) => ({
        operation,
        command: readPendingCommand<unknown>(
          identity,
          `party:/v1/parties/${party.id}/${operation}`,
        ),
      }))
      .find((entry) => entry.command);
  const inviteUrl = party ? localStorage.getItem(`quorem.party-invite.v1:${party.id}`) : null;
  useEffect(() => {
    if (party?.currentMatchId && activeMatch.match?.id === party.currentMatchId)
      window.location.assign(`/match/${party.currentMatchId}`);
  }, [party?.currentMatchId, activeMatch.match?.id]);
  const run = async (operation: string, body?: unknown, method = "POST") => {
    if (!party || pending) return;
    setPending(true);
    setError("");
    try {
      await partyCommand(identity, `/v1/parties/${party.id}/${operation}`, method, body);
      await client.invalidateQueries({ queryKey: ["current-party", identity] });
      if (operation === "leave" || operation === "disband") window.location.assign("/practice");
    } catch {
      setDisbanding(false);
      setRecoveryRevision((value) => value + 1);
      setError("Could not update the lobby. Retry the previous action.");
    } finally {
      setPending(false);
    }
  };
  const own = party?.members.find((member) => member.userId === identity);
  const host = party?.hostUserId === identity;
  const nav = <GlobalNav identity={identity} theme={preference} onThemeChange={setPreference} />;
  if (account.isPending || (!!account.data && query.isPending))
    return (
      <main className="match-page">
        {nav}
        <p role="status">Loading lobby…</p>
      </main>
    );
  if (!account.data)
    return (
      <main className="match-page">
        {nav}
        <section className="match-page-content">
          <h1>Sign in to open your lobby</h1>
          <a href="/login">Sign in</a>
        </section>
      </main>
    );
  if (!party)
    return (
      <main className="match-page">
        {nav}
        <section className="match-page-content">
          <h1>Lobby unavailable</h1>
          {query.isError && (
            <button className="button button-secondary" onClick={() => void query.refetch()}>
              Try again
            </button>
          )}
          <a href="/practice">Back to practice</a>
        </section>
      </main>
    );
  return (
    <main className="match-page">
      {nav}
      <section className="match-page-content">
        <div className="competitive-lobby-heading">
          <h1>Lobby</h1>
          <p>Your party stays together between rounds.</p>
        </div>
        {error && <p role="alert">{error}</p>}
        {recovery && (
          <p role="status">
            An action may have completed.{" "}
            <button
              className="quiet-button"
              disabled={pending}
              onClick={() =>
                void run(
                  recovery.operation,
                  recovery.operation === "settings" || recovery.operation === "ready"
                    ? recovery.command?.payload
                    : undefined,
                  recovery.operation === "settings" ? "PUT" : "POST",
                )
              }
            >
              Retry action
            </button>
          </p>
        )}
        {inviteUrl && (
          <button
            className="button button-secondary"
            onClick={() =>
              void navigator.clipboard
                .writeText(inviteUrl)
                .catch(() => setError("Could not copy invitation."))
            }
          >
            Copy invitation
          </button>
        )}
        <PartyMemberReadiness
          ownUserId={participantUserId(identity)}
          members={party.members}
          hostUserId={party.hostUserId}
        />
        {!party.currentMatchId && (
          <PartyReadyStatus countdownEndsAt={party.countdownEndsAt} queueError={party.queueError} />
        )}
        {party.currentMatchId && (
          <p>
            {activeMatch.match?.id === party.currentMatchId ? (
              <a href={`/match/${party.currentMatchId}`}>Return to match</a>
            ) : (
              "A round is in progress. You can join the next round."
            )}
          </p>
        )}
        {party.latestMatchId && latest.data && (
          <p>
            <a href={`/match/${party.latestMatchId}`}>Previous results</a> ·{" "}
            {latest.data.reviewPending ? (
              <span>Review available after judging finishes</span>
            ) : (
              <a href={`/match/${party.latestMatchId}/review`}>Review code</a>
            )}
          </p>
        )}
        <MatchSettings
          value={party.settings}
          identity={identity}
          participantCount={party.members.length}
          disabled={
            (!host && party.settings.rules?.settingsEditors !== "everyone") ||
            pending ||
            !!recovery ||
            !!party.currentMatchId
          }
          onChange={(settings) =>
            void run(
              "settings",
              {
                ...settings,
                shareCodeAfterMatch: party.settings.shareCodeAfterMatch,
              } satisfies PartySettings,
              "PUT",
            )
          }
          canEditPermissions={host}
          showHostRules
        />
        <div className="match-option">
          <span>Share code after match</span>
          <ToggleSwitch
            label="Share code after match"
            checked={party.settings.shareCodeAfterMatch}
            disabled={
              (!host && party.settings.rules?.settingsEditors !== "everyone") ||
              pending ||
              !!recovery ||
              !!party.currentMatchId
            }
            onChange={(shareCodeAfterMatch) =>
              void run("settings", { ...party.settings, shareCodeAfterMatch }, "PUT")
            }
          />
        </div>
        <footer className="competitive-lobby-footer">
          <span>Changing settings clears readiness.</span>
          <div className="lobby-ready-actions">
            <button
              className="button button-secondary"
              disabled={pending || !!recovery}
              onClick={() => void run("leave")}
            >
              Leave
            </button>
            {host && !party.currentMatchId && (
              <button
                className="button button-secondary"
                disabled={pending || !!recovery}
                onClick={() => setDisbanding(true)}
              >
                Disband
              </button>
            )}
            {!party.currentMatchId && (
              <button
                className={`button ${own?.ready ? "button-secondary" : "button-primary"}`}
                disabled={pending || !!recovery || !own?.online}
                onClick={() => void run("ready", { ready: !own?.ready })}
              >
                {own?.ready ? "Unready" : "Ready up"}
              </button>
            )}
            {host && !party.currentMatchId && !party.latestMatchId && (
              <button
                className="button button-primary"
                disabled={
                  pending ||
                  !!recovery ||
                  !party.members.every((member) => member.ready && member.online)
                }
                onClick={() => void run("start")}
              >
                Start match
              </button>
            )}
          </div>
        </footer>
        <SessionDialog
          open={disbanding}
          onOpenChange={setDisbanding}
          pending={pending}
          title="Disband lobby?"
          description="Everyone will leave this party and its invitation will expire."
        >
          <div className="competitive-dialog-actions">
            <button
              className="button button-secondary"
              disabled={pending}
              onClick={() => setDisbanding(false)}
            >
              Cancel
            </button>
            <button
              className="button button-danger"
              disabled={pending}
              onClick={() => void run("disband")}
            >
              Disband
            </button>
          </div>
        </SessionDialog>
      </section>
    </main>
  );
}
