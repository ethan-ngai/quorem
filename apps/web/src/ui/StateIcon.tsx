import type { ReactNode } from "react";
import "./state-icon.css";

/** Both states stay mounted so icon changes animate without shifting the control. */
export function StateIcon({ active, on, off }: { active: boolean; on: ReactNode; off: ReactNode }) {
  return (
    <span className="state-icon" data-active={active} aria-hidden="true">
      <span className="state-icon-off">{off}</span>
      <span className="state-icon-on">{on}</span>
    </span>
  );
}
