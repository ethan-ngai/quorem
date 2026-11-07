import "./results.css";
/** @file CaseBrowserLayout.tsx @description Shared case rail/detail geometry for execution and authoring. @module editor */
import { ScrollCue } from "../../../ui/ScrollCue";
import { useChangeMotion } from "../../../ui/useChangeMotion";
import type { ReactNode } from "react";

export function CaseBrowserLayout({
  rail,
  railLabel,
  children,
  busy = false,
  selection,
  status,
  actions,
}: {
  rail: ReactNode;
  railLabel: string;
  children: ReactNode;
  busy?: boolean;
  selection?: string;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  const detail = useChangeMotion<HTMLDivElement>(selection);
  return (
    <div className="case-browser" aria-busy={busy}>
      <ScrollCue viewportClassName="case-rail" role="group" aria-label={railLabel}>
        {rail}
      </ScrollCue>
      <div className="case-detail-panel">
        {actions && <div className="case-visibility-action">{actions}</div>}
        <ScrollCue viewportClassName="case-detail-scroll" resetKey={selection}>
          {status}
          <div ref={detail} className="case-details">
            {children}
          </div>
        </ScrollCue>
      </div>
    </div>
  );
}
