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

export function CreateMatchDialog({
  identity,
  onClose,
}: {
  identity: DevelopmentIdentity;
  onClose: () => void;
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
  const current = useParty(identity);
  return (
    <SessionDialog
      open={open}
      onOpenChange={setOpen}
      pending={pending}
      onExited={onClose}
      className="match-creation-dialog"
      title="Create lobby"
      description="Choose settings for your party."
      descriptionHidden
      actions={
        <>
          <span className="match-creation-options-slot" ref={setOptionsSlot} />
          {session.data?.capabilities?.hostGuests && (
            <GuestAccessToggle
              allowed={settings.accessMode === "guests_allowed"}
              disabled={pending || recovering}
              onToggle={() =>
                setSettings({
                  ...settings,
                  accessMode:
                    settings.accessMode === "guests_allowed" ? "accounts_only" : "guests_allowed",
                })
              }
            />
          )}
        </>
      }
    >
      {current.isPending ? (
        <p role="status">Checking your lobby…</p>
      ) : current.isError ? (
        <div>
          <p role="alert">Could not check your lobby.</p>
          <button className="button button-secondary" onClick={() => void current.refetch()}>
            Try again
          </button>
        </div>
      ) : current.data?.party && !recovering ? (
        <a className="button button-primary" href="/party">
          Return to lobby
        </a>
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
            heading={(options) => optionsSlot && createPortal(options, optionsSlot)}
          />
          {recovering && (
            <p role="status">Retry the previous request to recover your invitation.</p>
          )}
          {error && <p role="alert">{error}</p>}
          <footer className="competitive-dialog-actions">
            <span />
            <button className="button button-primary" disabled={pending}>
              {pending ? "Creating…" : recovering ? "Retry creation" : "Create lobby"}
            </button>
          </footer>
        </form>
      )}
    </SessionDialog>
  );
}
