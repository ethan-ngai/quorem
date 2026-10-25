/** @file ConcessionDialog.tsx @description Multiplayer-aware, reversible-before-confirmation forfeit prompt. @module matches */
import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Flag, X } from "lucide-react";

export function ConcessionDialog({
  open,
  pending,
  onCancel,
  onConfirm,
  freeForAll = false,
  remainingPlayers = 1,
}: {
  open: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  freeForAll?: boolean;
  remainingPlayers?: number;
}) {
  const keepPlaying = useRef<HTMLButtonElement>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value && !pending) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="settings-backdrop" />
        <Dialog.Content
          className="competitive-dialog forfeit-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            keepPlaying.current?.focus();
          }}
        >
          <button
            className="icon-button match-dialog-close"
            aria-label="Close forfeit dialog"
            disabled={pending}
            onClick={onCancel}
          >
            <X size={18} />
          </button>
          <span className="match-result-icon forfeit-icon">
            <Flag size={24} />
          </span>
          <Dialog.Title>Leave this match?</Dialog.Title>
          <Dialog.Description>
            {freeForAll && remainingPlayers > 1
              ? "You'll forfeit your place. The remaining players will keep competing."
              : "You'll forfeit and your opponent will win."}{" "}
            You can't rejoin this match.
          </Dialog.Description>
          <div className="competitive-dialog-actions">
            <button
              className="button button-secondary"
              disabled={pending}
              onClick={onCancel}
              ref={keepPlaying}
            >
              Keep playing
            </button>
            <button className="button button-danger" disabled={pending} onClick={onConfirm}>
              {pending ? "Forfeiting…" : "Forfeit & leave"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
