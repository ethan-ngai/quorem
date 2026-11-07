import "./results.css";
/** @file CaseBrowserLayout.tsx @description Shared case rail/detail geometry for execution and authoring. @module editor */
import { useChangeMotion } from "../../../ui/useChangeMotion";
import { useLayoutEffect, useRef, type ReactNode } from "react";
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
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [selection]);
  return (
    <div className="case-browser" aria-busy={busy}>
      <div className="case-rail" aria-label={railLabel}>
        {rail}
      </div>
      <div className="case-detail-panel">
        {actions && <div className="case-visibility-action">{actions}</div>}
        <div ref={scroll} className="case-detail-scroll">
          {status}
          <div ref={detail} className="case-details">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
