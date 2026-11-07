/** @file ParticipantName.tsx @description Shared participant photo, identity color and name. @module collaboration */
import type { ReactNode } from "react";
import { AccountAvatar } from "../navigation/AccountAvatar";
import { SelfIndicator } from "../../ui/SelfIndicator";
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
  nameAdornment,
  nameSuffix,
}: {
  participant: ParticipantIdentity;
  label?: string;
  self?: boolean;
  nameAdornment?: ReactNode;
  nameSuffix?: ReactNode;
}) {
  return (
    <span className="participant-name">
      <AccountAvatar
        name={participant.displayName}
        image={participant.image}
        color={participantColor(participant.userId, participant.color)}
        outline
      />
      <span className="participant-name-text">
        <span className="participant-name-label">
          {label ?? participant.displayName}
          {nameAdornment && <span className="participant-name-adornment">{nameAdornment}</span>}
        </span>
        {self && <SelfIndicator />}
        {nameSuffix}
      </span>
    </span>
  );
}
