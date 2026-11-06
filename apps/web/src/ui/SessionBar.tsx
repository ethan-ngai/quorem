/** @file SessionBar.tsx @description Shared competitive session strip and actions. @module ui */
import "./session-bar.css";
import type { ReactNode } from "react";
import { ListOrdered } from "lucide-react";
export function SessionBar({
  label,
  children,
  actions,
  onResults,
}: {
  label: string;
  children: ReactNode;
  actions: ReactNode;
  onResults?: () => void;
}) {
  return (
    <div className="competitive-scoreboard" aria-label={label}>
      {children}
      <div className="competitive-clock-actions">
        {actions}
        {onResults && (
          <button className="button button-secondary" onClick={onResults}>
            <ListOrdered size={16} aria-hidden="true" />
            Results
          </button>
        )}
      </div>
    </div>
  );
}
