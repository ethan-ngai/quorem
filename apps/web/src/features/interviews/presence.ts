/** @file presence.ts @description Interview participant notifications over shared editor presence. @module interviews */
import { toast } from "sonner";
import { createParticipantTracker } from "./participantEvents";
import {
  presenceExtension as sharedPresence,
  type CollaborationPresence,
} from "../collaboration/presence";
import type { InterviewSocket } from "./socket";

export type InterviewPresence = CollaborationPresence;

export function presenceExtension(transport: InterviewSocket, epoch: string, clientID: string) {
  const participants = createParticipantTracker(clientID);
  return sharedPresence(
    transport,
    epoch,
    clientID,
    (peers) => {
      for (const event of participants.update(peers)) {
        toast(`${event.name} ${event.joined ? "joined" : "left"} the interview`);
      }
    },
    () => participants.reset(),
  );
}
