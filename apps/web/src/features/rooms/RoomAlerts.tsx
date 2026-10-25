/** @file RoomAlerts.tsx @description Shared monitoring toast and persistent alert history. @module rooms */
import { useEffect, useMemo } from "react";
import { Bell, ClipboardPaste, Focus } from "lucide-react";
import { toast } from "sonner";
import * as Popover from "../../ui/Popover";
import { Tooltip } from "../../ui/Tooltip";
import { createAlertTracker } from "./alertTracker";
import "./room-alerts.css";

export type RoomAlert = {
  id: string;
  name: string;
  kind: "paste" | "focus";
  description: string;
  occurredAt: string;
};

function EventIcon({ kind }: { kind: RoomAlert["kind"] }) {
  const Icon = kind === "paste" ? ClipboardPaste : Focus;
  return <Icon className="room-event-icon" size={16} aria-hidden="true" />;
}

export function RoomAlerts({
  scope,
  events,
  version,
  limit,
  label,
}: {
  scope: string;
  events: readonly RoomAlert[];
  version: bigint;
  limit: number;
  label: string;
}) {
  const tracking = useMemo(
    () => ({ track: createAlertTracker<RoomAlert>(), notified: new Set<string>() }),
    [scope],
  );
  useEffect(() => {
    for (const event of tracking.track(version, events)) {
      const id = `room-alert:${scope}:${event.id}`;
      tracking.notified.add(id);
      if (tracking.notified.size > limit) {
        const oldest = tracking.notified.values().next().value!;
        toast.dismiss(oldest);
        tracking.notified.delete(oldest);
      }
      toast.warning(`${event.name} ${event.description}`, {
        id,
        icon: <EventIcon kind={event.kind} />,
      });
    }
  }, [events, version, scope, tracking, limit]);
  useEffect(
    () => () => {
      for (const id of tracking.notified) toast.dismiss(id);
      tracking.notified.clear();
    },
    [tracking],
  );
  return (
    <Popover.Root>
      <Tooltip content={label}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="icon-button room-alerts-trigger"
            aria-label={`Alerts (${events.length})`}
          >
            <Bell size={16} />
            {!!events.length && (
              <span className="room-alerts-count" aria-hidden="true">
                {events.length}
              </span>
            )}
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content className="room-alerts-popover" align="end">
          <header>
            <strong>Alerts</strong>
            {events.length === limit && <small>Most recent {limit} events</small>}
          </header>
          {events.length ? (
            <ol>
              {[...events].reverse().map((event) => (
                <li key={event.id}>
                  <EventIcon kind={event.kind} />
                  <div>
                    <strong>{event.name}</strong> {event.description}
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
