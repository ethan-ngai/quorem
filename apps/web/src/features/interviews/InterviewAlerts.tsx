import { useEffect, useRef } from "react";
import { Bell, ClipboardPaste, Focus } from "lucide-react";
import { toast } from "sonner";
import type { InterviewRuleEvent } from "@quorem/contracts";
import * as Popover from "../../ui/Popover";
import { Tooltip } from "../../ui/Tooltip";
import { createInterviewAlertTracker, interviewEventDescription } from "./ruleEvents";
import "./interview-alerts.css";

function InterviewEventIcon({ kind }: { kind: InterviewRuleEvent["kind"] }) {
  const Icon = kind === "paste" ? ClipboardPaste : Focus;
  return <Icon className="interview-event-icon" size={16} aria-hidden="true" />;
}

export function InterviewAlerts({
  sessionId,
  events,
  version,
}: {
  sessionId: string;
  events: readonly InterviewRuleEvent[];
  version: number;
}) {
  const tracker = useRef(createInterviewAlertTracker()).current;
  const notified = useRef(new Set<string>());
  useEffect(() => {
    for (const event of tracker(version, events)) {
      const id = `interview-alert:${sessionId}:${event.id}`;
      notified.current.add(id);
      if (notified.current.size > 100) {
        const oldest = notified.current.values().next().value!;
        toast.dismiss(oldest);
        notified.current.delete(oldest);
      }
      toast.warning(`${event.name} ${interviewEventDescription(event.kind)}`, {
        id,
        icon: <InterviewEventIcon kind={event.kind} />,
      });
    }
  }, [events, version, sessionId, tracker]);
  useEffect(
    () => () => {
      for (const id of notified.current) toast.dismiss(id);
      notified.current.clear();
    },
    [sessionId],
  );
  return (
    <Popover.Root>
      <Tooltip content="Interview alerts">
        <Popover.Trigger asChild>
          <button
            className="icon-button interview-alerts-trigger"
            aria-label={`Alerts (${events.length})`}
          >
            <Bell size={16} />
            {!!events.length && (
              <span className="interview-alerts-count" aria-hidden="true">
                {events.length}
              </span>
            )}
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content className="interview-alerts-popover" align="end">
          <header>
            <strong>Alerts</strong>
            {events.length === 100 && <small>Most recent 100 events</small>}
          </header>
          {events.length ? (
            <ol>
              {[...events].reverse().map((event) => (
                <li key={event.id}>
                  <InterviewEventIcon kind={event.kind} />
                  <div>
                    <strong>{event.name}</strong> {interviewEventDescription(event.kind)}
                    <time dateTime={event.occurredAt}>
                      {new Date(event.occurredAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p>No monitoring events.</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
