/** @file PersistentNotice.tsx @description Stable slots for persistent errors and recovery. @module ui */
import { CircleAlert, TriangleAlert } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";
import * as Popover from "./Popover";
import { Tooltip } from "./Tooltip";
import "./persistent-notice.css";

type NoticeProps = {
  message?: string | readonly string[] | null;
  label?: string;
  severity?: "error" | "warning";
  actions?: readonly { label: string; onClick: () => void }[];
  /** Accessible description ID for an associated control. */
  id?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** Keep mounted when healthy: the empty slot reserves identical geometry. */
export function PersistentNotice({
  message,
  label = "Needs attention",
  severity = "error",
  actions,
  id,
  open,
  onOpenChange,
}: NoticeProps) {
  const generatedId = useId();
  const descriptionId = id ?? generatedId;
  const headingId = useId();
  const slot = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const messages = [
    ...new Set((typeof message === "string" ? [message] : (message ?? [])).filter(Boolean)),
  ];
  const Icon = severity === "warning" ? TriangleAlert : CircleAlert;
  const accessibleLabel = messages.length > 1 ? `${label} (${messages.length} issues)` : label;
  return (
    <span ref={slot} tabIndex={-1} className="persistent-notice" data-severity={severity}>
      <span id={descriptionId} className="sr-only" role="status" aria-atomic="true">
        {messages.join(" ")}
      </span>
      {messages.length > 0 && (
        <Popover.Root open={open} onOpenChange={onOpenChange}>
          <Tooltip content={accessibleLabel}>
            <Popover.Trigger asChild>
              <button
                ref={trigger}
                type="button"
                className="persistent-notice-trigger"
                aria-label={accessibleLabel}
                aria-describedby={descriptionId}
              >
                <Icon size={16} aria-hidden="true" />
                {messages.length > 1 && (
                  <span className="persistent-notice-count" aria-hidden="true">
                    {messages.length > 9 ? "9+" : messages.length}
                  </span>
                )}
              </button>
            </Popover.Trigger>
          </Tooltip>
          <Popover.Portal>
            <Popover.Content
              className="persistent-notice-details"
              align="end"
              aria-labelledby={headingId}
              onCloseAutoFocus={(event) => {
                // Recovery can remove the trigger while its details still have focus.
                if (!trigger.current?.isConnected && slot.current?.isConnected) {
                  event.preventDefault();
                  slot.current.focus({ preventScroll: true });
                }
              }}
            >
              <h3 id={headingId}>{label}</h3>
              {messages.length === 1 ? (
                <p>{messages[0]}</p>
              ) : (
                <ul>
                  {messages.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              )}
              {actions && actions.length > 0 && (
                <div className="persistent-notice-actions">
                  {actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      className="button button-secondary"
                      onClick={action.onClick}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </span>
  );
}

/** Attach feedback to existing content without conditional rows or custom positioning. */
export function NoticeRegion({ children, ...notice }: NoticeProps & { children: ReactNode }) {
  const generatedId = useId();
  const id = notice.id ?? generatedId;
  return (
    <div className="notice-region" role="group" aria-describedby={id}>
      <div className="notice-region-content">{children}</div>
      <PersistentNotice {...notice} id={id} />
    </div>
  );
}
