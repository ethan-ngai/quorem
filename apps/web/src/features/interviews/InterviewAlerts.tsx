/** @file InterviewAlerts.tsx @description Interview event adapter for shared room alerts. @module interviews */
import type { InterviewRuleEvent } from "@quorem/contracts";
import { RoomAlerts } from "../rooms/RoomAlerts";
import { interviewEventDescription } from "./ruleEvents";

export function InterviewAlerts({
  sessionId,
  events,
  version,
}: {
  sessionId: string;
  events: readonly InterviewRuleEvent[];
  version: number;
}) {
  return (
    <RoomAlerts
      scope={`interview:${sessionId}`}
      version={BigInt(version)}
      limit={100}
      label="Interview alerts"
      events={events.map((event) => ({
        ...event,
        description: interviewEventDescription(event.kind),
      }))}
    />
  );
}
