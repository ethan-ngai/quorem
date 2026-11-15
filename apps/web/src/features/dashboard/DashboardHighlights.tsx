/** @file DashboardHighlights.tsx @description Activity timeline and stat charts. @module dashboard */
import { BookOpen, Swords } from "lucide-react";
import { OdysseyIcon } from "../../ui/OdysseyIcon";
import type { PlayerDashboard } from "@quorem/contracts";
import { DifficultyLabel } from "../../ui/DifficultyLabel";

const activityDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

const timelineKinds = {
  practiceAccepted: { label: "Practice", Icon: BookOpen },
  matchPlayed: { label: "Match", Icon: Swords },
  odyssey: { label: "Odyssey", Icon: OdysseyIcon },
} as const;

const outcomeLabels = { victory: "Victory", loss: "Loss", draw: "Draw" };

export function DashboardTimeline({ items }: { items: PlayerDashboard["recent"] }) {
  if (!items.length) return null;
  const today = new Date();
  return (
    <section
      className="dashboard-panel dashboard-timeline"
      aria-labelledby="dashboard-timeline-title"
    >
      <h2 id="dashboard-timeline-title">Recent activity</h2>
      <ol>
        {items.map((item) => {
          const { day, kind, title } = item;
          const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + day);
          const { label, Icon } = timelineKinds[kind];
          const dateTime = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
            .map((part) => String(part).padStart(2, "0"))
            .join("-");
          return (
            <li key={`${kind}:${item.id}`}>
              <span className="dashboard-timeline-marker" title={label}>
                <Icon size={14} aria-hidden="true" />
                <span className="sr-only">{label}</span>
              </span>
              <div className="dashboard-timeline-event">
                <strong>{title}</strong>
                <p>
                  {item.kind !== "matchPlayed" ? (
                    <DifficultyLabel difficulty={item.difficulty} />
                  ) : (
                    <span className="dashboard-timeline-outcome" data-outcome={item.outcome}>
                      {outcomeLabels[item.outcome]}
                    </span>
                  )}
                </p>
              </div>
              <time dateTime={dateTime}>{day === 0 ? "Today" : activityDate.format(date)}</time>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function DashboardDistribution({
  items,
  label,
}: {
  items: readonly { label: string; count: number; tone: string }[];
  label: string;
}) {
  return (
    <>
      <div className="dashboard-distribution" aria-hidden="true">
        {items
          .filter(({ count }) => count > 0)
          .map(({ label, count, tone }) => (
            <span key={label} data-tone={tone} style={{ flexGrow: count }} />
          ))}
      </div>
      <ul className="dashboard-breakdown" aria-label={label}>
        {items.map(({ label, count, tone }) => (
          <li key={label}>
            <span className="dashboard-dot" data-tone={tone} />
            {label}
            <strong>{count}</strong>
          </li>
        ))}
      </ul>
    </>
  );
}
