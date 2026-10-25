/** @file CaseBrowserLayout.tsx @description Shared case rail/detail geometry for execution and authoring. @module editor */
import type { ReactNode } from "react";
export function CaseBrowserLayout({
  rail,
  railLabel,
  children,
  busy = false,
}: {
  rail: ReactNode;
  railLabel: string;
  children: ReactNode;
  busy?: boolean;
}) {
  return (
    <div className="case-browser" aria-busy={busy}>
      <div className="case-rail" aria-label={railLabel}>
        {rail}
      </div>
      <div className="case-details">{children}</div>
    </div>
  );
}
