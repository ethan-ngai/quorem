/** @file CompletionOutcomeIcon.tsx @description Shared result icon and tone, independent of competitive mode. @module ui */
import type { ReactNode } from "react";
import { Check, Minus, X } from "lucide-react";
import { canCelebrate, type CompletionOutcome } from "./completionOutcome";
import { Icon } from "./Icon";
import "./completion-outcome-icon.css";

export function CompletionOutcomeIcon({
  outcome,
  successIcon,
  size = 20,
}: {
  outcome: CompletionOutcome;
  successIcon?: ReactNode;
  size?: number;
}) {
  return (
    <span className="completion-outcome-icon" data-outcome={outcome} aria-hidden="true">
      {outcome === "loss" ? (
        <X size={size} />
      ) : outcome === "draw" ? (
        <Icon name="draw" width={size} height={size} />
      ) : canCelebrate(outcome) ? (
        (successIcon ?? <Check size={size} />)
      ) : (
        <Minus size={size} />
      )}
    </span>
  );
}
