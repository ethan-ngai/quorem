/** @file Disclosure.tsx @description Shared settings disclosure with an optional inline trigger slot. @module ui */
import { useId, useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import { Tooltip } from "./Tooltip";
import "./disclosure.css";

export function Disclosure({
  title,
  header,
  highlighted = false,
  children,
}: {
  title: string;
  header?: (trigger: ReactNode) => ReactNode;
  highlighted?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const trigger = (
    <Tooltip content={title}>
      <button
        type="button"
        className="icon-button settings-disclosure-trigger"
        aria-label={title}
        aria-expanded={open}
        aria-controls={contentId}
        data-highlighted={highlighted || undefined}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Settings size={16} aria-hidden="true" />
      </button>
    </Tooltip>
  );
  return (
    <div className="settings-disclosure" data-open={open}>
      {header ? header(trigger) : <div className="settings-disclosure-actions">{trigger}</div>}
      <div id={contentId} className="settings-disclosure-panel" inert={!open}>
        <div className="settings-disclosure-content">{children}</div>
      </div>
    </div>
  );
}
