import { useErrorNotification } from "../../ui/Notifications";
import { userFacingErrorMessage } from "../../ui/errors";
import * as Dialog from "@radix-ui/react-dialog";
import type { CreateMatchRequest, DevelopmentIdentity } from "@quorem/contracts";
import { useState } from "react";
import { pendingCreate } from "./commandRecovery";
import { createMatch } from "./api";
import { MatchSettings, defaultMatchSettings } from "./MatchControls";
import { Icon } from "../editor/components/Icon";
import { Tooltip } from "../editor/components/Tooltip";
import { useActiveMatch } from "./useActiveMatch";

export function CreateMatchDialog({
  identity,
  onClose,
}: {
  identity: DevelopmentIdentity;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [settings, setSettings] = useState<CreateMatchRequest>(
    () => pendingCreate(identity)?.payload ?? defaultMatchSettings,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useErrorNotification(error);
  const activeMatch = useActiveMatch(identity);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!pending) setOpen(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="settings-backdrop" />
        <Dialog.Content
          className="competitive-dialog match-creation-dialog"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && !open) onClose();
          }}
        >
          <header className="competitive-dialog-heading">
            <div>
              <Dialog.Title>
                <Icon name="people" />
                {activeMatch.match ? "You already have an active match" : "Create match"}
              </Dialog.Title>
              <Dialog.Description className="match-dialog-description">
                {activeMatch.match
                  ? "Return to continue. Finish or leave this match before creating another."
                  : "Choose a mode, difficulty and problem."}
              </Dialog.Description>
            </div>
            <Tooltip content="Close">
              <Dialog.Close asChild>
                <button className="icon-button" aria-label="Close" disabled={pending}>
                  <Icon name="close" />
                </button>
              </Dialog.Close>
            </Tooltip>
          </header>
          {activeMatch.checking ? (
            <p role="status">Checking your active match…</p>
          ) : activeMatch.failed ? (
            <div>
              <p role="alert">Could not check your active match.</p>
              <button
                className="button button-secondary"
                onClick={() => void activeMatch.refresh()}
              >
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
