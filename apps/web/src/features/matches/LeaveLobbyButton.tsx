/** @file LeaveLobbyButton.tsx @description Explicit lobby exit, separate from dismissing results. @module matches */
import { LoadingButton } from "../../ui/LoadingButton";
import { LogOut } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";

export function LeaveLobbyButton({
  disabled = false,
  pending = false,
  onClick,
}: {
  disabled?: boolean;
  pending?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content="Leave lobby">
      <LoadingButton
        className="icon-button destructive-icon completion-leave"
        aria-label="Leave lobby"
        disabled={disabled}
        onClick={onClick}
        icon={<LogOut size={16} aria-hidden="true" />}
        pending={pending}
      />
    </Tooltip>
  );
}
