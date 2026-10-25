import { Tooltip } from "../../ui/Tooltip";

export function GuestAccessToggle({
  allowed,
  disabled,
  onToggle,
}: {
  allowed: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip
      content={
        allowed
          ? "Guest access on · click to require accounts"
          : "Guest access off · click to allow guests"
      }
    >
      <button
        type="button"
        className="icon-button guest-access-button"
        aria-label="Allow guests"
        aria-pressed={allowed}
        disabled={disabled}
        onClick={onToggle}
      >
        <svg
          className="guest-access-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="7" r="4" />
          <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
          <path className="guest-access-slash" pathLength="1" d="M3 3l18 18" />
        </svg>
      </button>
    </Tooltip>
  );
}
