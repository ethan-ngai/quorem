/** @file SelfIndicator.tsx @description Quiet star marker for the current participant. @module ui */
import { Star } from "lucide-react";
import { Tooltip } from "./Tooltip";
import "./self-indicator.css";

export function SelfIndicator({ focusable = true }: { focusable?: boolean }) {
  return (
    <Tooltip content="You">
      <span
        className="self-indicator"
        role="img"
        aria-label="You"
        tabIndex={focusable ? 0 : undefined}
      >
        <Star size={9} fill="currentColor" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}
