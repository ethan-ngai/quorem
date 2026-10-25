/** @file LobbyLock.tsx @description Admission control with an animated shackle. @module matches */
import { Tooltip } from "../../ui/Tooltip";

export function LobbyLock({
  locked,
  disabled,
  onToggle,
}: {
  locked: boolean;
  disabled: boolean;
  onToggle?: () => void;
}) {
  const label = locked ? "Unlock lobby" : "Lock lobby";
  const icon = (
    <svg
      className="lobby-lock-icon"
      data-locked={locked}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path className="lock-shackle" d="M7 11V7a5 5 0 0 1 10 0v4" />
      <rect x="4.5" y="11" width="15" height="10" rx="2.5" />
      <path d="M12 15v2" />
    </svg>
  );
  return (
    <Tooltip
      content={
        onToggle
          ? locked
            ? "Unlock lobby to allow new players"
            : "Lock lobby to stop new players joining"
          : locked
            ? "Lobby locked"
            : "Lobby open"
      }
    >
      {onToggle ? (
        <button
          type="button"
          className="icon-button lobby-lock-button"
          aria-label={label}
          aria-pressed={locked}
          disabled={disabled}
          onClick={onToggle}
        >
          {icon}
        </button>
      ) : (
        <span
          className="lobby-lock-status"
          role="img"
          aria-label={locked ? "Lobby locked" : "Lobby open"}
        >
          {icon}
        </span>
      )}
    </Tooltip>
  );
}
