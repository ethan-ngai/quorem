/** @file LeaveLobbyButton.tsx @description Explicit lobby exit, separate from dismissing results. @module matches */
import { LogOut } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";

export function LeaveLobbyButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content="Leave lobby">
      <button
        className="icon-button destructive-icon completion-leave"
        aria-label="Leave lobby"
        disabled={disabled}
        onClick={onClick}
      >
        <LogOut size={16} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
