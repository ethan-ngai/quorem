import { userFacingErrorMessage } from "../../ui/errors";
import * as Dialog from "@radix-ui/react-dialog";
import type { CreateMatchRequest, DevelopmentIdentity, MatchSnapshot } from "@quorem/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { pendingCreate } from "./commandRecovery";
import { createMatch } from "./api";
import { MatchSettings, defaultMatchSettings } from "./MatchControls";
import { Icon } from "../editor/components/Icon";
import { Tooltip } from "../editor/components/Tooltip";
import { api, requireData } from "../editor/api";
import { activeMatchReturnLabel } from "./matchState";

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
  const [recentMatch] = useState(() => {
    try {
      return localStorage.getItem(`quorem.last-match.v1:${identity}`);
    } catch {
      return null;
    }
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const activeMatch = useQuery({
    queryKey: ["return-match", identity, recentMatch],
    enabled: !!recentMatch,
    queryFn: async ({ signal }) => {
      const { data, error } = await api(identity).GET("/v1/matches/{id}", {
        params: { path: { id: recentMatch! } },
        signal,
      });
      return requireData(data as MatchSnapshot | undefined, error);
    },
    retry: false,
    refetchInterval: 5000,
    staleTime: 0,
  });
  const returnLabel =
    activeMatch.isFetchedAfterMount && !activeMatch.isError && activeMatch.data
      ? activeMatchReturnLabel(activeMatch.data, identity)
      : null;
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
                Create match
              </Dialog.Title>
              <Dialog.Description className="match-dialog-description">
                Choose a mode, difficulty and problem.
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
            {error && (
              <p className="result-error" role="alert">
                {error}
              </p>
            )}
            <footer className="competitive-dialog-actions">
              {returnLabel && activeMatch.data ? (
                <a className="text-link" href={`/match/${activeMatch.data.id}`}>
                  <Icon name="history" />
                  {returnLabel}
                </a>
              ) : (
                <span />
              )}
              <button className="button button-primary" disabled={pending}>
                {pending ? "Creating…" : "Create match"}
                <Icon name="arrow" />
              </button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
