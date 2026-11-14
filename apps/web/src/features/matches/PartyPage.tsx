import { LoadingButton } from "../../ui/LoadingButton";
import { useFactionLobby } from "../factions/useFactionLobby";
import { allFactionsOccupied } from "@quorem/contracts/factions";
import { StateIcon } from "../../ui/StateIcon";
import { LoadingIndicator } from "../../ui/Spinner";
import { TeamOrganizer } from "../factions/TeamOrganizer";
/** @file PartyPage.tsx @description Persistent lobby and shared readiness controls. @module matches */
import { participantUserId } from "@quorem/contracts";
import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAccountIdentity, MatchSettings, LobbySetupHeading } from "./MatchControls";
import {
  partyCommand,
  readPartyInvitation,
  useParty,
  type Party,
  type PartySettings,
} from "./party";
import { PartyInvitation } from "./PartyInvitation";
import { GuestAccessToggle } from "./GuestAccessToggle";
import { PartyReadyStatus, PartyMemberReadiness } from "./PartyReadyStatus";
import { usePartyRoundNavigation } from "./useActiveMatch";
import { useTheme } from "../editor/useTheme";
import { GlobalNav } from "../navigation/GlobalNav";
import { usePageTitle } from "../navigation/PageMetadata";
import { matchModeLabels } from "./ModeIcon";
import { readPendingCommand } from "./commandRecovery";
import { Trash2, UserMinus, DoorOpen, DoorClosed } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import { LeaveLobbyButton } from "./LeaveLobbyButton";
import { SessionDialog } from "../../ui/SessionDialog";
import { RejectedMatchCommand } from "./errors";
import { ContentTransition } from "../../ui/ContentTransition";
import { SignInRedirect } from "../auth/RouteAccess";
import { isRouteDenied } from "../auth/protectedRoute";
import { NotFoundPage } from "../public/NotFoundPage";

const factionReadyHint = "Every faction needs at least one player";
const settingsReadyHint =
  "Changing the round or guest access, or enabling code sharing, resets readiness.";

export function PartyPage() {
  const { identity, account } = useAccountIdentity();
  const { preference, setPreference } = useTheme();
  const query = useParty(identity, !!account.data);
  const client = useQueryClient();
  const [pendingOperation, setPendingOperation] = useState<string>();
  const pending = pendingOperation !== undefined;
  const readyPending = pendingOperation === "ready";
  const [joiningAction, setJoiningAction] = useState<"guest" | "lock">();
  const joiningPending = joiningAction !== undefined;
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
  const status = query.error instanceof RejectedMatchCommand ? query.error.status : undefined;
  const denied = isRouteDenied(status);
  const party = denied || status === 401 ? undefined : query.data?.party;
  const mode = party?.settings.mode;
  usePageTitle(mode ? `${matchModeLabels[mode]} Lobby - Quorem` : undefined);
  const rosterMode = party?.currentMatchId ? undefined : mode;
  const factions = useFactionLobby(party?.id, mode === "factions");
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
  const waitingForNextRound = usePartyRoundNavigation(identity, party?.currentMatchId);
  const recovery =
    !pending &&
    party &&
    ["settings", "ready", "leave", "disband", "kick"]
      .map((operation) => ({
        operation,
        command: readPendingCommand<unknown>(
          identity,
          `party:/v1/parties/${party.id}/${operation}`,
        ),
      }))
      .find((entry) => entry.command);
  const inviteUrl = party ? readPartyInvitation(party.id) : undefined;
  const run = async (
    operation: string,
    body?: unknown,
    method = "POST",
    scope?: "guest" | "lock",
  ) => {
    if (!party) return;
    const settings = operation === "settings" ? (body as PartySettings) : undefined;
    if (activeCommand.current) {
      if (
        settings &&
        activeCommand.current.operation === "settings" &&
        activeCommand.current.partyId === party.id &&
        !scope
      ) {
        queuedSettings.current = settings;
        setPendingSettings({ partyId: party.id, value: settings });
      }
      return;
    }
    activeCommand.current = { operation, partyId: party.id };
    setPendingOperation(operation);
    setJoiningAction(scope);
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
          ? failure.message
          : "Could not update the lobby. Retry the previous action.",
      );
    } finally {
      activeCommand.current = undefined;
      queuedSettings.current = undefined;
      setPendingOperation(undefined);
      setJoiningAction(undefined);
      setPendingSettings(undefined);
    }
  };
  const own = party?.members.find((member) => member.userId === identity);
  const readyLabel = own?.ready ? "Unready" : "Ready up";
  const host = party?.hostUserId === identity;
  const nav = <GlobalNav identity={identity} theme={preference} onThemeChange={setPreference} />;
  if (account.isPending || query.isPending)
    return (
      <main className="match-page">
        {nav}
        <LoadingIndicator label="Loading lobby…" />
      </main>
    );
  if (status === 401) return <SignInRedirect />;
  if (denied || (!query.isError && !party)) return <NotFoundPage />;
  if (!party)
    return (
      <main className="match-page">
        {nav}
        <section className="match-page-content">
          <h1>Lobby unavailable</h1>
          <LoadingButton
            className="button button-secondary"
            onClick={() => void query.refetch()}
            pending={query.isFetching}
          >
            Try again
          </LoadingButton>
          <Link className="button button-secondary" to="/practice">
            Back to practice
          </Link>
        </section>
      </main>
    );
  const displayedSettings =
    pendingSettings?.partyId === party.id ? pendingSettings.value : party.settings;
  const guestsAllowed = displayedSettings.accessMode === "guests_allowed";
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
              <LoadingButton
                className={`button ${own?.ready ? "button-secondary" : "button-primary"}`}
                aria-label={readyLabel}
                disabled={!!recovery || !own?.online || (!own.ready && !factionsReady)}
                onClick={() => void run("ready", { ready: !own?.ready })}
                pending={readyPending}
              >
                {readyLabel}
              </LoadingButton>
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
              {inviteUrl && (
                <PartyInvitation
                  url={inviteUrl}
                  locked={displayedSettings.admissionLocked}
                  hostName={
                    party.members.find((member) => member.userId === party.hostUserId)?.displayName
                  }
                  settings={party.settings}
                />
              )}
              {host && !party.currentMatchId && account.data?.capabilities?.hostGuests && (
                <GuestAccessToggle
                  allowed={guestsAllowed}
                  disabled={joiningPending || !!recovery}
                  pending={joiningAction === "guest"}
                  onToggle={() =>
                    void run(
                      "settings",
                      {
                        ...party.settings,
                        accessMode: guestsAllowed ? "accounts_only" : "guests_allowed",
                      },
                      "PUT",
                      "guest",
                    )
                  }
                />
              )}
              {host && !party.currentMatchId && (
                <Tooltip
                  content={
                    displayedSettings.admissionLocked
                      ? "Unlock lobby joining"
                      : "Lock lobby joining"
                  }
                >
                  <LoadingButton
                    type="button"
                    className="icon-button"
                    aria-label={
                      displayedSettings.admissionLocked
                        ? "Unlock lobby joining"
                        : "Lock lobby joining"
                    }
                    aria-pressed={!!displayedSettings.admissionLocked}
                    onClick={() =>
                      void run(
                        "settings",
                        { ...party.settings, admissionLocked: !party.settings.admissionLocked },
                        "PUT",
                        "lock",
                      )
                    }
                    icon={
                      <StateIcon
                        active={!!displayedSettings.admissionLocked}
                        on={<DoorClosed size={16} />}
                        off={<DoorOpen size={16} />}
                      />
                    }
                    disabled={joiningPending || !!recovery}
                    pending={joiningAction === "lock"}
                  />
                </Tooltip>
              )}
              <LeaveLobbyButton
                pending={pendingOperation === "leave"}
                disabled={!!recovery}
                onClick={() => void run("leave")}
              />
              {host && !party.currentMatchId && (
                <Tooltip content="Disband lobby">
                  <button
                    className="icon-button destructive-icon"
                    aria-label="Disband lobby"
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
              firstMatch={!party.latestMatchId}
              queueError={party.queueError}
            />
          )}
          {waitingForNextRound && <p>A round is in progress. You can join the next round.</p>}
        </fieldset>
        {readinessActions}
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
            heading={(options) => (
              <LobbySetupHeading
                options={options}
                hint={
                  host || party.settings.rules?.settingsEditors === "everyone"
                    ? settingsReadyHint
                    : `Only the host can change settings. ${settingsReadyHint}`
                }
              />
            )}
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
            <LoadingButton
              className="button button-danger"
              disabled={controlsPending}
              onClick={() => kicking && void run("kick", { userId: kicking.userId })}
              pending={pendingOperation === "kick"}
            >
              Remove player
            </LoadingButton>
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
            <LoadingButton
              className="button button-danger"
              disabled={controlsPending}
              onClick={() => void run("disband")}
              pending={pendingOperation === "disband"}
            >
              Disband
            </LoadingButton>
          </div>
        </SessionDialog>
      </section>
    </main>
  );
}
