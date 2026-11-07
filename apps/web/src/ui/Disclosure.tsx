/** @file Disclosure.tsx @description Shared in-flow settings disclosure. @module ui */
import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import "./disclosure.css";

export function Disclosure({
  title,
  summary,
  children,
}: {
  title: string;
  summary?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <div className="settings-disclosure">
      <button
        type="button"
        className="settings-disclosure-trigger"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight size={16} className="disclosure-chevron" aria-hidden="true" />
        <span>{title}</span>
        {summary && <small>{summary}</small>}
      </button>
      <div id={contentId} className="settings-disclosure-panel" inert={!open}>
        <div className="settings-disclosure-content">{children}</div>
      </div>
    </div>
  );
}
