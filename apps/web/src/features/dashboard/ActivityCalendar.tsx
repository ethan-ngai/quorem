/** @file ActivityCalendar.tsx @description Daily practice and match activity in the dashboard preview. @module dashboard */
import { useState, type CSSProperties } from "react";
import { SelectField } from "../../ui/SelectField";
import "../../ui/text-control.css";
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

const periods = [30, 90, activityHistoryDays]
  .map((days) => ({
    value: String(days),
    label: `Last ${days} days`,
  }))
  .concat({ value: "custom", label: "Custom period" });

const dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });
const monthLabel = new Intl.DateTimeFormat(undefined, { month: "short" });

function describeDay(day: { practice: number; matches: number }) {
  return `${day.practice} accepted practice ${day.practice === 1 ? "submission" : "submissions"} · ${day.matches} ${day.matches === 1 ? "match" : "matches"}`;
}

export function ActivityCalendar({ activity }: { activity: ReturnType<typeof summarizeActivity> }) {
  const [period, setPeriod] = useState(String(activityHistoryDays));
  const [customDays, setCustomDays] = useState(60);
  const [selected, setSelected] = useState(0);
  const range = period === "custom" ? customDays : Number(period);
  const current = new Date();
  const days = Array.from({ length: range }, (_, index) => {
    const offset = index - range + 1;
    const date = new Date(current.getFullYear(), current.getMonth(), current.getDate() + offset);
    const counts = activity.get(offset) ?? { practice: 0, matches: 0 };
    return { offset, date, ...counts, total: counts.practice + counts.matches };
  });
  const firstWeekday = days[0].date.getDay();
  const weeks = Math.ceil((range + firstWeekday) / 7);
  const activeDay = Math.max(selected, 1 - range);
  const detail = days[activeDay + range - 1];
  const months = new Map<number, string>();
  for (const [index, day] of days.entries()) {
    if (index === 0 || day.date.getDate() === 1) {
      months.set(Math.floor((index + firstWeekday) / 7) + 1, monthLabel.format(day.date));
    }
  }

  return (
    <section
      className="activity-calendar dashboard-panel"
      aria-labelledby="activity-calendar-title"
    >
      <div className="activity-calendar-header">
        <div>
          <h2 id="activity-calendar-title">Activity calendar</h2>
          <p className="dashboard-caption">
            {days.filter(({ total }) => total > 0).length} active days · Sample data
          </p>
        </div>
        <div className="activity-calendar-controls">
          <SelectField
            label="Activity period"
            value={period}
            options={periods}
            onChange={setPeriod}
          />
          {period === "custom" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setCustomDays(Number(new FormData(event.currentTarget).get("days")));
              }}
            >
              <input
                name="days"
                className="text-control"
                type="number"
                required
                min={1}
                max={activityHistoryDays}
                defaultValue={customDays}
                aria-label="Number of days"
              />
              <button className="button button-secondary" type="submit">
                Apply
              </button>
            </form>
          )}
        </div>
      </div>
      <div
        className="activity-calendar-chart"
        style={{ "--activity-weeks": weeks } as CSSProperties}
      >
        <div className="activity-calendar-months" aria-hidden="true">
          {[...months].map(([week, month]) => (
            <span key={week} style={{ gridColumn: week }}>
              {month}
            </span>
          ))}
        </div>
        <div className="activity-calendar-weekdays" aria-hidden="true">
          <span>Sun</span>
          <span>Wed</span>
          <span>Sat</span>
        </div>
        <div
          className="activity-calendar-grid"
          role="group"
          aria-label="Daily activity. Use arrow keys to move between days."
        >
          {days.map((day, index) => (
            <button
              type="button"
              key={day.offset}
              data-day={day.offset}
              data-level={Math.min(day.total, 4)}
              style={{
                gridRow: day.date.getDay() + 1,
                gridColumn: Math.floor((index + firstWeekday) / 7) + 1,
              }}
              aria-label={`${dateLabel.format(day.date)}. ${describeDay(day)}`}
              aria-pressed={day.offset === activeDay}
              tabIndex={day.offset === activeDay ? 0 : -1}
              onClick={() => setSelected(day.offset)}
              onKeyDown={(event) => {
                const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key];
                if (step === undefined) return;
                event.preventDefault();
                const next = Math.max(1 - range, Math.min(0, day.offset + step));
                event.currentTarget.parentElement
                  ?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)
                  ?.focus();
                setSelected(next);
              }}
            />
          ))}
        </div>
      </div>
      <div className="activity-calendar-footer">
        <p aria-live="polite">
          <strong>{dateLabel.format(detail.date)}</strong> · {describeDay(detail)}
        </p>
        <div className="activity-calendar-legend" aria-label="Activity intensity">
          Less{" "}
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} data-level={level} aria-hidden="true" />
          ))}{" "}
          More
        </div>
      </div>
    </section>
  );
}
