/** @file CreateMatchDialog.tsx @description Creates a private invitation from the practice workspace. @module matches */
import type { CreateMatchRequest, DevelopmentIdentity } from "@quorem/contracts";
import { useEffect, useRef, useState } from "react";
import { createMatch } from "./api";
import { MatchSettings } from "./MatchControls";
import { Icon } from "../editor/components/Icon";

/** @returns A modal create flow; the server-issued link stays private. */
export function CreateMatchDialog({
  identity,
  onClose,
}: {
  identity: DevelopmentIdentity;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<CreateMatchRequest>({
    difficulty: "easy",
    durationMinutes: 30,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className="match-dialog"
      ref={dialog}
      onCancel={onClose}
      aria-labelledby="create-match-title"
    >
      <header className="dialog-header">
        <span className="eyebrow">Private 1v1</span>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <form
        className="match-dialog-body"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setError(undefined);
          try {
            const invite = await createMatch(identity, settings);
            sessionStorage.setItem(`quorem.invite.${identity}.${invite.id}`, invite.inviteUrl);
            window.location.assign(`/matches/${invite.id}`);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not create match.");
            setPending(false);
          }
        }}
      >
        <h2 id="create-match-title">Invite an opponent.</h2>
        <p>Same problem. Separate code. The problem appears when both players are ready.</p>
        <MatchSettings value={settings} onChange={setSettings} disabled={pending} />
        {error && (
          <p className="result-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary" disabled={pending}>
          {pending ? "Creating…" : "Create private match"}
          <Icon name="arrow" />
        </button>
        <small>Playing as {identity === "alice" ? "Alice" : "Bob"} · 2 players</small>
      </form>
    </dialog>
  );
}
