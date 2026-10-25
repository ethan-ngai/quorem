/** @file ConcessionDialog.tsx @description Multiplayer-aware forfeit confirmation using shared session chrome. @module matches */
import { useRef } from "react";
import { Flag } from "lucide-react";
import { SessionDialog } from "../../ui/SessionDialog";

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
    <SessionDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onCancel();
      }}
      className="forfeit-dialog"
      initialFocus={keepPlaying}
      closeLabel="Close forfeit dialog"
      pending={pending}
      title={
        <>
          <span className="match-result-icon forfeit-icon">
            <Flag size={24} />
          </span>
          Leave this match?
        </>
      }
      description={`${
        freeForAll && remainingPlayers > 1
          ? "You'll forfeit your place. The remaining players will keep competing."
          : "You'll forfeit and your opponent will win."
      } You can't rejoin this match.`}
    >
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
    </SessionDialog>
  );
}
