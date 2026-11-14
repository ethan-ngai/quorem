/** @file ActivityCalendar.tsx @description Daily practice and match activity in the dashboard preview. @module dashboard */
import { motion } from "@quorem/ui/tokens";
import { useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { BookOpen, Flame, Swords } from "lucide-react";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { DashboardStreak } from "./DashboardHighlights";
import "./activity-calendar.css";

export const activityHistoryDays = 180;
export type ActivityEvent = {
  day: number;
  kind: "matchPlayed" | "practiceAccepted" | "practiceRejected";
};

export function summarizeActivity(events: readonly ActivityEvent[]) {
  const days = new Map<number, { practice: number; matches: number }>();
  for (const { day, kind } of events) {
    if (kind === "practiceRejected") continue;
    const counts = days.get(day) ?? { practice: 0, matches: 0 };
    if (kind === "practiceAccepted") counts.practice++;
    else counts.matches++;
    days.set(day, counts);
  }
  return days;
}

const periods = [30, 90, activityHistoryDays].map((days) => ({
  value: String(days),
  label: `${days} days`,
}));

const dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });
const compactDateLabel = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const monthLabel = new Intl.DateTimeFormat(undefined, { month: "short" });
const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function describeDay(day: { practice: number; matches: number }) {
  return [
    { count: day.matches, label: day.matches === 1 ? "match" : "matches", Icon: Swords },
    { count: day.practice, label: day.practice === 1 ? "problem" : "problems", Icon: BookOpen },
  ].filter(({ count }) => count > 0);
}

export function ActivityCalendar({
  activity,
  streakDays,
}: {
  activity: ReturnType<typeof summarizeActivity>;
  streakDays: number;
}) {
  const [period, setPeriod] = useState(String(activityHistoryDays));
  const [selected, setSelected] = useState(0);
  const rangeTransition = useRef<ViewTransition>(null);
  const grid = useRef<HTMLDivElement>(null);
  const tileAnimations = useRef<Animation[]>([]);

  function updatePeriod(next: string) {
    // Batch geometry reads on either side of the commit, then animate transforms only.
    const before = new Map(
      Array.from(grid.current?.querySelectorAll("button[data-day]") ?? [], (tile) => [
        tile,
        tile.getBoundingClientRect(),
      ]),
    );
    for (const animation of tileAnimations.current) animation.cancel();
    flushSync(() => setPeriod(next));

    const tiles = Array.from(grid.current?.querySelectorAll("button[data-day]") ?? []);
    const after = tiles.map((tile) => tile.getBoundingClientRect());
    const timing = { duration: Number.parseFloat(motion.standard), easing: motion.easing };

    tileAnimations.current = tiles.flatMap((tile, index) => {
      const previous = before.get(tile);
      if (!previous) return tile.animate([{ opacity: 0 }, { opacity: 1 }], timing);
      const current = after[index]!;
      const x = previous.left - current.left;
      const y = previous.top - current.top;
      if (!x && !y && previous.width === current.width) return [];
      const scale = previous.width / current.width;
      return tile.animate(
        [{ transform: `translate(${x}px, ${y}px) scale(${scale})` }, { transform: "none" }],
        timing,
      );
    });
  }

  function changePeriod(next: string) {
    if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPeriod(next);
      return;
    }

    const root = document.documentElement;
    root.classList.add("activity-range-transition");
    const transition = document.startViewTransition(() => updatePeriod(next));
    rangeTransition.current = transition;

    const cleanup = () => {
      if (rangeTransition.current !== transition) return;
      rangeTransition.current = null;
      root.classList.remove("activity-range-transition");
    };
    void transition.finished.then(cleanup, cleanup);
  }

  const range = Number(period);
  const current = new Date();
  const days = Array.from({ length: range }, (_, index) => {
    const offset = index - range + 1;
    const date = new Date(current.getFullYear(), current.getMonth(), current.getDate() + offset);
    const counts = activity.get(offset) ?? { practice: 0, matches: 0 };
    return { offset, date, ...counts, total: counts.practice + counts.matches };
  });
  const activeDays = days.filter(({ total }) => total > 0).length;
  const activeDay = Math.max(selected, 1 - range);
  const detail = days[activeDay + range - 1];

  const firstWeekday = days[0].date.getDay();
  const weeks = Math.ceil((firstWeekday + range) / 7);
  const monthLabels = new Map<number, string>();
  const spansYears = days[0].date.getFullYear() !== current.getFullYear();
  const yearLabels = new Map<number, string>();
  for (const [index, { date }] of days.entries()) {
    const week = Math.floor((firstWeekday + index) / 7) + 1;
    if (index === 0 || date.getDate() === 1) monthLabels.set(week, monthLabel.format(date));
    if (spansYears && (index === 0 || (date.getMonth() === 0 && date.getDate() === 1))) {
      yearLabels.set(week, String(date.getFullYear()));
    }
  }

  return (
    <section
      className="activity-calendar dashboard-panel"
      data-period={range}
      aria-labelledby="activity-calendar-title"
    >
      <div className="activity-calendar-header">
        <div className="activity-calendar-overview">
          <div>
            <h2 id="activity-calendar-title">Activity calendar</h2>
            <p className="dashboard-caption activity-calendar-active-days">
              <Flame size={14} aria-hidden="true" />
              <span className="activity-calendar-count">
                {activeDays} {activeDays === 1 ? "day" : "days"}
              </span>
              <span className="sr-only">with activity. Sample data.</span>
            </p>
          </div>
          <DashboardStreak days={streakDays} />
        </div>
        <SegmentedControl
          label="Activity period"
          value={period}
          options={periods}
          onChange={changePeriod}
        />
      </div>
      <p className="activity-calendar-range">{shortDate.formatRange(days[0].date, current)}</p>
      <div
        className="activity-calendar-chart"
        style={{ "--activity-weeks": weeks } as CSSProperties}
      >
        <div className="activity-calendar-labels-group">
          {(spansYears ? [yearLabels, monthLabels] : [monthLabels]).map((labels) => (
            <div
              key={labels === yearLabels ? "years" : "months"}
              className="activity-calendar-labels"
              aria-hidden="true"
            >
              {[...labels].map(([week, label]) => (
                <span key={week} style={{ gridColumn: week }} data-last={week === weeks}>
                  {label}
                </span>
              ))}
            </div>
          ))}
        </div>
        <div
          ref={grid}
          className="activity-calendar-grid"
          role="group"
          aria-label="Daily activity. Use arrow keys to move between days."
        >
          {days.map((day, index) => (
            <button
              type="button"
              key={day.offset}
              data-day={day.offset}
              style={{
                gridRow: day.date.getDay() + 1,
                gridColumn: Math.floor((firstWeekday + index) / 7) + 1,
              }}
              data-level={Math.min(day.total, 4)}
              aria-label={`${dateLabel.format(day.date)}. ${
                describeDay(day)
                  .map(({ count, label }) => `${count} ${label}`)
                  .join(", ") || "No activity"
              }`}
              aria-pressed={day.offset === activeDay}
              tabIndex={day.offset === activeDay ? 0 : -1}
              onClick={() => setSelected(day.offset)}
              onKeyDown={(event) => {
                const grid = event.currentTarget.parentElement;
                const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key];
                if (step === undefined) return;
                event.preventDefault();
                const next = Math.max(1 - range, Math.min(0, day.offset + step));
                grid?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus();
                setSelected(next);
              }}
            />
          ))}
        </div>
      </div>
      <p className="activity-calendar-detail" aria-live="polite">
        <strong className="activity-calendar-date-full">{dateLabel.format(detail.date)}</strong>
        <strong className="activity-calendar-date-compact">
          {compactDateLabel.format(detail.date)}
        </strong>
        {describeDay(detail).map(({ count, label, Icon }) => (
          <span key={label}>
            <Icon size={14} aria-hidden="true" />
            {`${count} ${label}`}
          </span>
        ))}
      </p>
    </section>
  );
}
