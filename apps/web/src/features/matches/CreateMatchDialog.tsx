/** @file CreateMatchDialog.tsx @description Shared lobby creation flow for the page and dialog. @module matches */
import { LoadingButton } from "../../ui/LoadingButton";
import { CircleAlert, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { DevelopmentIdentity } from "@quorem/contracts";
import { SessionDialog } from "../../ui/SessionDialog";
import { useSession } from "../auth/session";
import { GuestAccessToggle } from "./GuestAccessToggle";
import { MatchSettings, defaultMatchSettings } from "./MatchControls";
import { readPendingCommand } from "./commandRecovery";
import {
  partyCommand,
  savePartyInvitation,
  useParty,
  type Party,
  type PartySettings,
} from "./party";
import { LoadingIndicator } from "../../ui/Spinner";

export function CreateMatchDialog(props: { identity: DevelopmentIdentity; onClose: () => void }) {
  return <CreateLobbySetup {...props} />;
}

export function CreateLobbySetup({
  identity,
  onClose,
}: {
  identity: DevelopmentIdentity;
  onClose?: () => void;
}) {
  const session = useSession();
  const [open, setOpen] = useState(true);
  const [optionsSlot, setOptionsSlot] = useState<HTMLSpanElement | null>(null);
  const [saved] = useState(
    () => readPendingCommand<PartySettings>(identity, "party:/v1/parties")?.payload,
  );
  const [settings, setSettings] = useState<PartySettings>(saved ?? defaultMatchSettings);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [recovering, setRecovering] = useState(
    () => !!readPendingCommand(identity, "party:/v1/parties"),
  );
  const current = useParty(identity, true, false, { refetchOnMount: false });
  const returnToLobby = current.data?.party && !recovering;
  const showSettings = !current.isPending && !current.isError && !returnToLobby;
  const guestAccess = session.data?.capabilities?.hostGuests && (
    <GuestAccessToggle
      allowed={settings.accessMode === "guests_allowed"}
      disabled={pending || recovering}
      onToggle={() =>
        setSettings({
          ...settings,
          accessMode: settings.accessMode === "guests_allowed" ? "accounts_only" : "guests_allowed",
        })
      }
    />
  );
  const content = current.isPending ? (
    <LoadingIndicator label="Checking your lobby…" />
  ) : returnToLobby ? (
    <a className="button button-primary" href="/party">
      Return to lobby
    </a>
  ) : current.isError ? (
    <div className="match-creation-recovery" aria-busy={current.isFetching}>
      <div className="match-creation-recovery-message" role="alert">
        <CircleAlert size={18} aria-hidden="true" />
        <span>Lobby status unavailable</span>
      </div>
      <LoadingButton
        type="button"
        className="button button-secondary"
        onClick={() => void current.refetch()}
        pending={current.isFetching}
        icon={<RotateCcw size={16} />}
      >
        Try again
      </LoadingButton>
    </div>
  ) : (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        setError("");
        try {
          const created = await partyCommand<{ party: Party; inviteUrl: string }>(
            identity,
            "/v1/parties",
            "POST",
            settings,
          );
          savePartyInvitation(created.party.id, created.inviteUrl);
          window.location.assign("/party");
        } catch {
          setRecovering(!!readPendingCommand(identity, "party:/v1/parties"));
          setError("Could not create lobby. Retry the same request.");
          setPending(false);
        }
      }}
    >
      <MatchSettings
        value={settings}
        identity={identity}
        onChange={setSettings}
        disabled={pending || recovering}
        heading={
          onClose ? (options) => optionsSlot && createPortal(options, optionsSlot) : undefined
        }
      />
      {recovering && <p role="status">Retry the previous request to recover your invitation.</p>}
      {error && <p role="alert">{error}</p>}
      <footer className={onClose ? "competitive-dialog-actions" : "competitive-lobby-footer"}>
        <span />
        <LoadingButton
          className="button button-primary"
          pending={pending}
          icon={recovering ? <RotateCcw size={16} /> : <Plus size={16} />}
        >
          {pending ? "Creating…" : recovering ? "Retry creation" : "Create lobby"}
        </LoadingButton>
      </footer>
    </form>
  );

  if (!onClose)
    return (
      <>
        <header className="competitive-lobby-heading">
          <h1>Create lobby</h1>
          {showSettings && guestAccess}
        </header>
        {content}
      </>
    );

  return (
    <SessionDialog
      open={open}
      onOpenChange={setOpen}
      pending={pending}
      onExited={onClose}
      className={showSettings ? "match-creation-dialog" : "match-creation-status-dialog"}
      title="Create lobby"
      description="Choose settings for your party."
      descriptionHidden
      actions={
        showSettings && (
          <>
            <span className="match-creation-options-slot" ref={setOptionsSlot} />
            {guestAccess}
          </>
        )
      }
    >
      {content}
    </SessionDialog>
  );
}
