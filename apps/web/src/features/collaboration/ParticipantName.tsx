/** @file ParticipantName.tsx @description Shared participant photo, identity color and name. @module collaboration */
import { AccountAvatar } from "../navigation/AccountAvatar";
import { SelfIndicator } from "../../ui/SelfIndicator";
import { participantColor } from "./participantColor";
import "./participant-name.css";

export type ParticipantIdentity = {
  userId: string;
  displayName: string;
  username?: string | null;
  image?: string;
  color?: number;
};

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
      <span className="participant-name-details">
        <span className="participant-name-text">
          <span>{label ?? participant.displayName}</span>
          {self && <SelfIndicator />}
        </span>
        {participant.username && (
          <span className="participant-name-username">@{participant.username}</span>
        )}
      </span>
    </span>
  );
}
