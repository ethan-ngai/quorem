/** @file SessionBar.tsx @description Shared competitive session strip and actions. @module ui */
import "./session-bar.css";
import type { ReactNode } from "react";
export function SessionBar({
  label,
  children,
  actions,
}: {
  label: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="competitive-scoreboard" aria-label={label}>
      {children}
      <div className="competitive-clock-actions">{actions}</div>
    </div>
  );
}
