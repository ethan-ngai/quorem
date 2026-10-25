import { GuestAccessToggle } from "./GuestAccessToggle";
import { useErrorNotification } from "../../ui/Notifications";
import { userFacingErrorMessage } from "../../ui/errors";
import { SessionDialog } from "../../ui/SessionDialog";
import type { CreateMatchRequest, DevelopmentIdentity } from "@quorem/contracts";
import { useState } from "react";
import { useSession } from "../auth/session";
import { pendingCreate } from "./commandRecovery";
import { createMatch } from "./api";
import { MatchSettings, defaultMatchSettings } from "./MatchControls";
import { Icon } from "../../ui/Icon";
import { useActiveMatch } from "./useActiveMatch";

export function CreateMatchDialog({
  identity,
  onClose,
}: {
  identity: DevelopmentIdentity;
  onClose: () => void;
}) {
  const session = useSession();
  const [open, setOpen] = useState(true);
  const [settings, setSettings] = useState<CreateMatchRequest>(
    () => pendingCreate(identity)?.payload ?? defaultMatchSettings,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useErrorNotification(error);
  const activeMatch = useActiveMatch(identity);
  return (
    <SessionDialog
      open={open}
      onOpenChange={setOpen}
      pending={pending}
      descriptionHidden
      onExited={onClose}
      className="match-creation-dialog"
      title={
        <>
          <Icon name="people" />
          {activeMatch.match ? "You already have an active match" : "Create match"}
        </>
      }
      description={
        activeMatch.match
          ? "Return to continue. Finish or leave this match before creating another."
          : "Choose a mode, difficulty and problem."
      }
      actions={
        <>
          {!activeMatch.checking &&
            !activeMatch.failed &&
            !activeMatch.match &&
            session.data?.kind !== "guest" &&
            session.data?.capabilities?.hostGuests && (
              <GuestAccessToggle
                allowed={settings.accessMode === "guests_allowed"}
                disabled={pending || !!pendingCreate(identity)}
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
      {activeMatch.checking ? (
        <p role="status">Checking your active match…</p>
      ) : activeMatch.failed ? (
        <div>
          <p role="alert">Could not check your active match.</p>
          <button className="button button-secondary" onClick={() => void activeMatch.refresh()}>
            Try again
          </button>
        </div>
      ) : activeMatch.match ? (
        <div className="competitive-dialog-actions">
          <a className="button button-primary" href={`/match/${activeMatch.match.id}`}>
            {activeMatch.label}
          </a>
        </div>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending) return;
            setPending(true);
            setError(undefined);
            try {
              const invite = await createMatch(identity, settings);
              window.location.assign(`/match/${invite.id}`);
            } catch (cause) {
              setError(userFacingErrorMessage(cause, "Could not create match."));
              void activeMatch.refresh();
              setPending(false);
            }
          }}
        >
          <MatchSettings
            value={settings}
            identity={identity}
            onChange={setSettings}
            disabled={pending || !!pendingCreate(identity)}
          />

          <footer className="competitive-dialog-actions">
            <span />
            <button className="button button-primary" disabled={pending}>
              {pending ? "Creating…" : "Create match"}
              <Icon name="arrow" />
            </button>
          </footer>
        </form>
      )}
    </SessionDialog>
  );
}
