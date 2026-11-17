/** @file DashboardHighlights.tsx @description Activity timeline and stat charts. @module dashboard */
import { BookOpen } from "lucide-react";
import { OdysseyIcon } from "../../ui/OdysseyIcon";
import type { PlayerDashboard } from "@quorem/contracts";
import { DifficultyLabel } from "../../ui/DifficultyLabel";
import { matchModeLabels, ModeIcon } from "../matches/ModeIcon";

const activityDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

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
          const label =
            item.kind === "matchPlayed"
              ? item.mode
                ? matchModeLabels[item.mode]
                : "Match"
              : kind === "odyssey"
                ? "Odyssey"
                : "Practice";
          const dateTime = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
            .map((part) => String(part).padStart(2, "0"))
            .join("-");
          return (
            <li key={`${kind}:${item.id}`}>
              <span className="dashboard-timeline-marker" title={label}>
                {item.kind === "matchPlayed" ? (
                  <ModeIcon mode={item.mode} />
                ) : kind === "odyssey" ? (
                  <OdysseyIcon />
                ) : (
                  <BookOpen aria-hidden="true" />
                )}
                <span className="sr-only">{label}</span>
              </span>
              <div className="dashboard-timeline-event">
                <strong>{title}</strong>
                {item.kind === "matchPlayed" && !!item.opponents?.length && (
                  <p>vs. {item.opponents.join(", ")}</p>
                )}
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
