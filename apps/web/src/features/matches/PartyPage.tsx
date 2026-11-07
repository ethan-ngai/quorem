import { useFactionLobby } from "../factions/useFactionLobby";
import { allFactionsOccupied } from "@quorem/contracts/factions";
import { StateIcon } from "../../ui/StateIcon";
import { Spinner } from "../../ui/Spinner";
import { TeamOrganizer } from "../factions/TeamOrganizer";
/** @file PartyPage.tsx @description Persistent lobby and shared readiness controls. @module matches */
import { participantUserId } from "@quorem/contracts";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccountIdentity, MatchSettings } from "./MatchControls";
import { partyCommand, useParty, type Party, type PartySettings } from "./party";
import { PartyReadyStatus, PartyMemberReadiness } from "./PartyReadyStatus";
import { useActiveMatch } from "./useActiveMatch";
import { useTheme } from "../editor/useTheme";
import { GlobalNav } from "../navigation/GlobalNav";
import { readPendingCommand } from "./commandRecovery";
import { Trash2, Info, UserMinus, DoorOpen, DoorClosed } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import { LeaveLobbyButton } from "./LeaveLobbyButton";
import { SessionDialog } from "../../ui/SessionDialog";
import { RejectedMatchCommand } from "./errors";
import { ContentTransition } from "../../ui/ContentTransition";

const factionReadyHint = "Every faction needs at least one player";

export function PartyPage() {
  const { identity, account } = useAccountIdentity();
  const { preference, setPreference } = useTheme();
  const query = useParty(identity, !!account.data);
  const client = useQueryClient();
  const [pendingOperation, setPendingOperation] = useState<string>();
  const pending = pendingOperation !== undefined;
  const readyPending = pendingOperation === "ready";
  const [joiningPending, setJoiningPending] = useState(false);
  const [pendingSettings, setPendingSettings] = useState<{
    partyId: string;
    value: PartySettings;
  }>();
  const activeCommand = useRef<{ operation: string; partyId: string } | undefined>(undefined);
  const queuedSettings = useRef<PartySettings | undefined>(undefined);
  const controlsPending = pending && !joiningPending;
  const [kicking, setKicking] = useState<{ userId: string; displayName: string }>();
  const [disbanding, setDisbanding] = useState(false);
  const [error, setError] = useState("");
  const [, setRecoveryRevision] = useState(0);
  const party = query.data?.party;
  const rosterMode = party?.currentMatchId ? undefined : party?.settings.mode;
  const factions = useFactionLobby(party?.id, party?.settings.mode === "factions");
  const showFactions = rosterMode === "factions" && (!!factions.data || factions.isError);
  const factionsReady =
    party?.settings.mode !== "factions" ||
    (!!factions.data &&
      allFactionsOccupied({
        ...factions.data,
        assignments: factions.data.assignments.filter((assignment) =>
          party.members.some((member) => member.userId === assignment.userId),
        ),
      }));
  const activeMatch = useActiveMatch(identity, !!party?.currentMatchId);
  const recovery =
    !pending &&
    party &&
    ["settings", "ready", "start", "leave", "disband", "kick"]
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
  const run = async (operation: string, body?: unknown, method = "POST", scope = "all") => {
    if (!party) return;
    const settings = operation === "settings" ? (body as PartySettings) : undefined;
    if (activeCommand.current) {
      if (
        settings &&
        activeCommand.current.operation === "settings" &&
        activeCommand.current.partyId === party.id &&
        scope !== "joining"
      ) {
        queuedSettings.current = settings;
        setPendingSettings({ partyId: party.id, value: settings });
      }
      return;
    }
    activeCommand.current = { operation, partyId: party.id };
    setPendingOperation(operation);
    setJoiningPending(scope === "joining");
    if (settings) setPendingSettings({ partyId: party.id, value: settings });
    setError("");
    const path = `/v1/parties/${party.id}/${operation}`;
    const queryKey = ["current-party", identity];
    try {
      if (settings) {
        let next: PartySettings | undefined = settings;
        while (next) {
          const sent = next;
          const saved = await partyCommand<Party>(identity, path, method, sent);
          await client.cancelQueries({ queryKey });
          const current = client.getQueryData<{ party: Party | null }>(queryKey)?.party;
          if (current?.id !== saved.id) break;
          if (BigInt(current.version) <= BigInt(saved.version))
            client.setQueryData(queryKey, { party: saved });
          // Take the latest draft only after the previous command has a definitive result.
          next = queuedSettings.current;
          queuedSettings.current = undefined;
          if (next && JSON.stringify(next) === JSON.stringify(sent)) break;
        }
        void client.invalidateQueries({ queryKey });
      } else {
        await partyCommand(identity, path, method, body);
        await client.invalidateQueries({ queryKey });
      }
      if (operation === "kick") setKicking(undefined);
      if (operation === "leave" || operation === "disband") window.location.assign("/practice");
    } catch (failure) {
      setDisbanding(false);
      setRecoveryRevision((value) => value + 1);
      setError(
        failure instanceof RejectedMatchCommand
          ? "Could not update the lobby."
          : "Could not update the lobby. Retry the previous action.",
      );
    } finally {
      activeCommand.current = undefined;
      queuedSettings.current = undefined;
      setPendingOperation(undefined);
      setJoiningPending(false);
      setPendingSettings(undefined);
    }
  };
  const own = party?.members.find((member) => member.userId === identity);
  const readyLabel = own?.ready ? "Unready" : "Ready up";
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
  const displayedSettings =
    pendingSettings?.partyId === party.id ? pendingSettings.value : party.settings;
  const memberActions = (member: { userId: string; displayName: string }) =>
    host && !party.currentMatchId && member.userId !== identity ? (
      <Tooltip content={`Remove ${member.displayName}`}>
        <button
          type="button"
          className="icon-button destructive-icon"
          data-reveal
          aria-label={`Remove ${member.displayName} from lobby`}
          disabled={!!recovery}
          onClick={() => setKicking(member)}
        >
          <UserMinus size={16} aria-hidden="true" />
        </button>
      </Tooltip>
    ) : null;
  const readinessActions = (
    <fieldset className="lobby-command-lock" disabled={controlsPending} aria-busy={controlsPending}>
      <div className="competitive-lobby-footer">
        <div className="lobby-ready-actions">
          {!party.currentMatchId && (
            <Tooltip content={factionReadyHint} disabled={!!own?.ready || factionsReady}>
              <button
                className={`button ${own?.ready ? "button-secondary" : "button-primary"}`}
                aria-label={readyLabel}
                aria-busy={readyPending}
                disabled={!!recovery || !own?.online || (!own.ready && !factionsReady)}
                onClick={() => void run("ready", { ready: !own?.ready })}
              >
                <StateIcon
                  active={readyPending}
                  off={readyLabel}
                  on={<Spinner active={readyPending} />}
                />
              </button>
            </Tooltip>
          )}
          {host && own?.ready && !party.currentMatchId && !party.latestMatchId && (
            <Tooltip content={factionReadyHint} disabled={factionsReady}>
              <button
                className="button button-primary"
                disabled={
                  !!recovery ||
                  !party.members.every((member) => member.ready && member.online) ||
                  !factionsReady
                }
                onClick={() => void run("start")}
              >
                Start match
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </fieldset>
  );
  return (
    <main className="match-page">
      {nav}
      <section className="match-page-content party-lobby">
        <fieldset
          className="lobby-command-lock"
          disabled={controlsPending}
          aria-busy={controlsPending}
        >
          <div className="competitive-lobby-heading">
            <h1>Lobby</h1>
            <div className="lobby-heading-actions">
              {host && !party.currentMatchId && (
                <Tooltip
                  content={
                    displayedSettings.admissionLocked
                      ? "Unlock lobby joining"
                      : "Lock lobby joining"
                  }
                >
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={
                      displayedSettings.admissionLocked
                        ? "Unlock lobby joining"
                        : "Lock lobby joining"
                    }
                    aria-pressed={!!displayedSettings.admissionLocked}
                    aria-busy={joiningPending}
                    disabled={joiningPending || !!recovery}
                    onClick={() =>
                      void run(
                        "settings",
                        { ...party.settings, admissionLocked: !party.settings.admissionLocked },
                        "PUT",
                        "joining",
                      )
                    }
                  >
                    <StateIcon
                      active={!!displayedSettings.admissionLocked}
                      on={<DoorClosed size={16} />}
                      off={<DoorOpen size={16} />}
                    />
                  </button>
                </Tooltip>
              )}
              <LeaveLobbyButton disabled={!!recovery} onClick={() => void run("leave")} />
              {host && !party.currentMatchId && (
                <Tooltip content="Disband lobby">
                  <button
                    className="icon-button destructive-icon"
                    aria-label="Disband lobby"
                    disabled={!!recovery}
                    onClick={() => setDisbanding(true)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
          {error && <p role="alert">{error}</p>}
          {recovery && (
            <p role="status">
              An action may have completed.{" "}
              <button
                className="quiet-button"
                onClick={() =>
                  void run(
                    recovery.operation,
                    recovery.operation === "settings" ||
                      recovery.operation === "ready" ||
                      recovery.operation === "kick"
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
          <ContentTransition
            className="lobby-roster"
            contentKey={showFactions ? "factions" : "players"}
          >
            {showFactions ? (
              <TeamOrganizer party={party} identity={identity} memberActions={memberActions} />
            ) : (
              <PartyMemberReadiness
                ownUserId={participantUserId(identity)}
                members={party.members}
                actions={memberActions}
                hostUserId={party.hostUserId}
              />
            )}
          </ContentTransition>
          {!party.currentMatchId && (
            <PartyReadyStatus
              countdownEndsAt={party.countdownEndsAt}
              queueError={party.queueError}
            />
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
        </fieldset>
        {readinessActions}
        <div className="lobby-setup-heading">
          <h2>Match setup</h2>
          <Tooltip
            content={
              host || party.settings.rules?.settingsEditors === "everyone"
                ? "Changing settings resets everyone's readiness."
                : "Only the host can change settings. Changes reset everyone's readiness."
            }
          >
            <button type="button" className="icon-button" aria-label="About lobby settings">
              <Info size={16} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        <fieldset className="lobby-command-lock" disabled={controlsPending && !pendingSettings}>
          <MatchSettings
            value={displayedSettings}
            identity={identity}
            participantCount={party.members.length}
            disabled={
              (!host && party.settings.rules?.settingsEditors !== "everyone") ||
              !!recovery ||
              !!party.currentMatchId
            }
            onChange={(settings) => void run("settings", settings satisfies PartySettings, "PUT")}
            canEditPermissions={host}
          />
        </fieldset>
        {readinessActions}
        <SessionDialog
          open={!!kicking}
          onOpenChange={(open) => {
            if (!open) setKicking(undefined);
          }}
          pending={controlsPending}
          title={`Remove ${kicking?.displayName ?? "player"}?`}
          description="They will leave this lobby. They can join again with an invitation."
        >
          <div className="competitive-dialog-actions">
            <button
              className="button button-secondary"
              disabled={controlsPending}
              onClick={() => setKicking(undefined)}
            >
              Cancel
            </button>
            <button
              className="button button-danger"
              disabled={controlsPending}
              onClick={() => kicking && void run("kick", { userId: kicking.userId })}
            >
              Remove player
            </button>
          </div>
        </SessionDialog>
        <SessionDialog
          open={disbanding}
          onOpenChange={setDisbanding}
          pending={controlsPending}
          title="Disband lobby?"
          description="Everyone will leave this party and its invitation will expire."
        >
          <div className="competitive-dialog-actions">
            <button
              className="button button-secondary"
              disabled={controlsPending}
              onClick={() => setDisbanding(false)}
            >
              Cancel
            </button>
            <button
              className="button button-danger"
              disabled={controlsPending}
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
