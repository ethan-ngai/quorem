/** @file RoomAlerts.tsx @description Shared monitoring toast and persistent alert history. @module rooms */
import { useEffect, useMemo, useState } from "react";
import { Bell, ClipboardPaste, Copy, EyeOff, Focus, Send, Tags, Timer } from "lucide-react";
import { toast } from "sonner";
import { AnimatedRows } from "../../ui/AnimatedRows";
import { useChangeMotion } from "../../ui/useChangeMotion";
import * as Popover from "../../ui/Popover";
import { Tooltip } from "../../ui/Tooltip";
import { createAlertTracker } from "./alertTracker";
import "./room-alerts.css";

const alertIcons = {
  paste: ClipboardPaste,
  copy: Copy,
  focus: Focus,
  topics: Tags,
  complexity: Timer,
  hiddenCase: EyeOff,
  submission: Send,
};

const relativeTime = new Intl.RelativeTimeFormat(undefined, { style: "narrow" });
const exactTime = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});
const ageUnits = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
] as const;

export type RoomAlert = {
  id: string;
  userId: string;
  name: string;
  kind: keyof typeof alertIcons;
  description: string;
  occurredAt: string;
  seconds?: number;
  points?: number;
};

function EventIcon({ event }: { event: RoomAlert }) {
  const { kind, seconds, points } = event;
  const Icon = alertIcons[kind];
  const tone =
    seconds || points
      ? "error"
      : kind === "topics" || kind === "complexity" || kind === "hiddenCase"
        ? "info"
        : "warning";
  return <Icon className="room-event-icon" data-tone={tone} size={16} aria-hidden="true" />;
}

function AlertMessage({ event, count = 1 }: { event: RoomAlert; count?: number }) {
  const countMotion = useChangeMotion<HTMLSpanElement>(count);
  return (
    <>
      <strong>{event.name}</strong> {event.description}
      {count > 1 && (
        <span ref={countMotion} className="room-alert-repeat motion-reveal">
          ×{count}
        </span>
      )}
      {!!event.seconds && <span className="room-alert-penalty">+{event.seconds}s</span>}
      {!!event.points && (
        <span className="room-alert-penalty">
          −{event.points} {event.points === 1 ? "point" : "points"}
        </span>
      )}
    </>
  );
}

function AlertTimestamp({
  occurredAt,
  now,
  grouped,
}: {
  occurredAt: string;
  now: number;
  grouped: boolean;
}) {
  const timestamp = Date.parse(occurredAt);
  if (!Number.isFinite(timestamp)) return null;
  const seconds = Math.floor(Math.max(0, now - timestamp) / 1000);
  const [unit, size] = ageUnits.find(([, size]) => seconds >= size) ?? ageUnits[3];
  return (
    <Tooltip
      content={
        grouped ? `Latest event · ${exactTime.format(timestamp)}` : exactTime.format(timestamp)
      }
    >
      <time className="room-alert-age" dateTime={occurredAt} tabIndex={0}>
        {seconds ? relativeTime.format(-Math.floor(seconds / size), unit) : "Just now"}
      </time>
    </Tooltip>
  );
}

function groupAlerts(events: readonly RoomAlert[]) {
  const groups: (RoomAlert & { count: number })[] = [];
  for (const event of events) {
    const previous = groups.at(-1);
    if (
      previous &&
      previous.userId === event.userId &&
      previous.kind === event.kind &&
      Boolean(previous.seconds || previous.points) === Boolean(event.seconds || event.points)
    ) {
      previous.count++;
      previous.occurredAt = event.occurredAt;
      previous.seconds = (previous.seconds ?? 0) + (event.seconds ?? 0);
      previous.points = (previous.points ?? 0) + (event.points ?? 0);
    } else {
      groups.push({ ...event, count: 1 });
    }
  }
  return groups.reverse();
}

function AlertHistory({ events }: { events: readonly RoomAlert[] }) {
  const [now, setNow] = useState(Date.now);
  const items = useMemo(() => groupAlerts(events), [events]);
  const hasEvents = items.length > 0;
  useEffect(() => {
    if (!hasEvents) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasEvents]);
  return (
    <AnimatedRows
      as="ol"
      className="room-alerts-history"
      items={items}
      getKey={(event) => event.id}
      renderRow={(event) => (
        <>
          <EventIcon event={event} />
          <div>
            <AlertMessage event={event} count={event.count} />
            <AlertTimestamp occurredAt={event.occurredAt} now={now} grouped={event.count > 1} />
          </div>
        </>
      )}
    />
  );
}

export function RoomAlerts({
  scope,
  events,
  version,
  label,
}: {
  scope: string;
  events: readonly RoomAlert[];
  version: bigint;
  label: string;
}) {
  const count = useChangeMotion<HTMLSpanElement>(events.length);
  const tracking = useMemo(
    () => ({ track: createAlertTracker<RoomAlert>(), notified: new Set<string>() }),
    [scope],
  );
  useEffect(() => {
    for (const event of tracking.track(version, events)) {
      const id = `room-alert:${scope}:${event.id}`;
      tracking.notified.add(id);
      toast.warning(<AlertMessage event={event} />, {
        id,
        icon: <EventIcon event={event} />,
        onDismiss: () => tracking.notified.delete(id),
        onAutoClose: () => tracking.notified.delete(id),
      });
    }
  }, [events, version, scope, tracking]);
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
              <span ref={count} className="room-alerts-count motion-reveal" aria-hidden="true">
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
          </header>
          <AlertHistory events={events} />
          {events.length === 0 && <p className="motion-reveal">No monitoring events.</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
