import "./results.css";
/** @file CaseBrowserLayout.tsx @description Shared case rail/detail geometry for execution and authoring. @module editor */
import { useChangeMotion } from "../../../ui/useChangeMotion";
import type { ReactNode } from "react";
export function CaseBrowserLayout({
  rail,
  railLabel,
  children,
  busy = false,
  selection,
}: {
  rail: ReactNode;
  railLabel: string;
  children: ReactNode;
  busy?: boolean;
  selection?: string;
}) {
  const detail = useChangeMotion<HTMLDivElement>(selection);
  return (
    <div className="case-browser" aria-busy={busy}>
      <div className="case-rail" aria-label={railLabel}>
        {rail}
      </div>
      <div ref={detail} className="case-details">
        {children}
      </div>
    </div>
  );
}
