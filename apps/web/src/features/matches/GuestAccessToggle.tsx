/** @file GuestAccessToggle.tsx @description Animated guest admission control. @module matches */
import { LoadingButton } from "../../ui/LoadingButton";
import { useId } from "react";
import { Tooltip } from "../../ui/Tooltip";

export function GuestAccessToggle({
  allowed,
  disabled,
  pending = false,
  onToggle,
}: {
  allowed: boolean;
  disabled: boolean;
  pending?: boolean;
  onToggle: () => void;
}) {
  const slashId = useId();
  const maskId = `${slashId}-cutout`;
  return (
    <Tooltip
      content={
        allowed
          ? "Guest access on · click to require accounts"
          : "Guest access off · click to allow guests"
      }
    >
      <LoadingButton
        type="button"
        className="icon-button guest-access-button"
        aria-label="Allow guests"
        aria-pressed={allowed}
        disabled={disabled}
        onClick={onToggle}

        icon={
          <svg
            className="guest-access-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <defs>
              <path id={slashId} pathLength="1" d="M3 2l19 19" />
              <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                <rect width="24" height="24" fill="white" stroke="none" />
                <use
                  href={`#${slashId}`}
                  className="guest-access-slash"
                  stroke="black"
                  strokeWidth="6.4"
                />
              </mask>
            </defs>
            <g mask={`url(#${maskId})`}>
              <circle cx="12" cy="7" r="4" />
              <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
            </g>
            <use href={`#${slashId}`} className="guest-access-slash" />
          </svg>
        }
        pending={pending}
      />
    </Tooltip>
  );
}
