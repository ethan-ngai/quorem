/** @file ParticipantName.tsx @description Shared participant photo, identity color and name. @module collaboration */
import type { ReactNode } from "react";
import { Star } from "lucide-react";
import { AccountAvatar } from "../navigation/AccountAvatar";
import { Tooltip } from "../../ui/Tooltip";
import { participantColor } from "./participantColor";
import "./participant-name.css";

export type ParticipantIdentity = {
  userId: string;
  displayName: string;
  image?: string;
  color?: number;
};

export function ParticipantName({
  participant,
  label,
  self = false,
  host = false,
  nameSuffix,
}: {
  participant: ParticipantIdentity;
  label?: string;
  self?: boolean;
  host?: boolean;
  nameSuffix?: ReactNode;
}) {
  return (
    <span className="participant-name">
      <Tooltip content="You" disabled={!self}>
        <span className="participant-name-identity" tabIndex={self ? 0 : undefined}>
          <AccountAvatar
            name={participant.displayName}
            image={participant.image}
            color={participantColor(participant.userId, participant.color)}
            outline
          />
          <span className="participant-name-label">{label ?? participant.displayName}</span>
        </span>
      </Tooltip>
      {host && <ParticipantHost />}
      {nameSuffix}
    </span>
  );
}

export function ParticipantHost() {
  return (
    <Tooltip content="Lobby host">
      <span className="participant-host" role="img" aria-label="Lobby host" tabIndex={0}>
        <Star size={12} fill="currentColor" aria-hidden="true" />
      </span>
    </Tooltip>
  );
}
