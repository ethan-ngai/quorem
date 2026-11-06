/** @file ParticipantName.tsx @description Shared participant photo, identity color and name. @module collaboration */
import { AccountAvatar } from "../navigation/AccountAvatar";
import { participantColor } from "./participantColor";
import "./participant-name.css";

export type ParticipantIdentity = {
  userId: string;
  displayName: string;
  image?: string;
  color?: number;
};

export function participantNameLabel(name: string, self = false) {
  return `${name}${self ? " (you)" : ""}`;
}

export function ParticipantName({
  participant,
  label,
  self = false,
}: {
  participant: ParticipantIdentity;
  label?: string;
  self?: boolean;
}) {
  return (
    <span className="participant-name">
      <AccountAvatar
        name={participant.displayName}
        image={participant.image}
        color={participantColor(participant.userId, participant.color)}
        outline
      />
      <span>{label ?? participantNameLabel(participant.displayName, self)}</span>
    </span>
  );
}
