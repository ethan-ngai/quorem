/** @file SessionDialog.tsx @description Shared competitive dialog chrome for session setup and membership. @module ui */
import "./session-dialog.css";
import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode, RefObject } from "react";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";
import { focusOverlayOnOpen } from "./overlayFocus";

export function SessionDialog({
  open,
  onOpenChange,
  title,
  description,
  descriptionHidden = false,
  children,
  actions,
  pending = false,
  className = "",
  onExited,
  returnFocus,
  initialFocus,
  closeLabel = "Close",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: string;
  descriptionHidden?: boolean;
  children: ReactNode;
  actions?: ReactNode;
  pending?: boolean;
  className?: string;
  onExited?: () => void;
  returnFocus?: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  closeLabel?: string;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!pending) onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="session-backdrop" />
        <Dialog.Content
          className={`competitive-dialog ${className}`}
          onOpenAutoFocus={(event) => {
            if (!event.defaultPrevented && initialFocus?.current) {
              event.preventDefault();
              initialFocus.current.focus({ preventScroll: true });
            } else focusOverlayOnOpen(event);
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocus) {
              event.preventDefault();
              returnFocus();
            }
          }}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && !open) onExited?.();
          }}
        >
          <header className="competitive-dialog-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description
                className={descriptionHidden ? "match-dialog-description" : undefined}
              >
                {description}
              </Dialog.Description>
            </div>
            <div className="lobby-heading-actions">
              {actions}
              <Tooltip content={closeLabel}>
                <Dialog.Close asChild>
                  <button className="icon-button" aria-label={closeLabel} disabled={pending}>
                    <Icon name="close" />
                  </button>
                </Dialog.Close>
              </Tooltip>
            </div>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
