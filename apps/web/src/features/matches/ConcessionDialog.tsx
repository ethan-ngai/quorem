/** @file ConcessionDialog.tsx @description Explicit, modal match concession. @module matches */
import { useEffect, useRef } from "react";

/** @returns A focus-contained confirmation before the irreversible forfeit command. */
export function ConcessionDialog({
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="concession-dialog"
      aria-labelledby="concession-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <h2 id="concession-title">Concede this match?</h2>
      <p>Your opponent wins. This cannot be undone.</p>
      <div className="dialog-actions">
        <button className="button button-secondary" disabled={pending} onClick={onCancel}>
          Keep playing
        </button>
        <button className="button button-danger" disabled={pending} onClick={onConfirm}>
          {pending ? "Conceding…" : "Forfeit match"}
        </button>
      </div>
      {error && (
        <p role="alert" className="result-error">
          {error}
        </p>
      )}
    </dialog>
  );
}
