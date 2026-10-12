import * as Dialog from "@radix-ui/react-dialog";
import { Icon } from "../editor/components/Icon";

export function ConcessionDialog({
  open,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value && !pending) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="settings-backdrop" />
        <Dialog.Content className="competitive-dialog">
          <header className="competitive-dialog-heading">
            <div>
              <Dialog.Title>
                <Icon name="flag" />
                Forfeit match?
              </Dialog.Title>
              <Dialog.Description>Your opponent wins. This cannot be undone.</Dialog.Description>
            </div>
          </header>
          <div className="competitive-dialog-actions">
            <button
              className="button button-secondary"
              disabled={pending}
              onClick={onCancel}
              autoFocus
            >
              Keep playing
            </button>
            <button className="button button-danger" disabled={pending} onClick={onConfirm}>
              {pending ? "Forfeiting…" : "Forfeit match"}
            </button>
          </div>
          {error && (
            <p role="alert" className="result-error">
              {error}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
