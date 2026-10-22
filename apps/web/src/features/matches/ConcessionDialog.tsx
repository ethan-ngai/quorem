import * as Dialog from "@radix-ui/react-dialog";
import { Icon } from "../editor/components/Icon";

export function ConcessionDialog({
  open,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
