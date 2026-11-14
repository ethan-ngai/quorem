/** @file DashboardDemo.tsx @description Fixture-backed player dashboard and streak states. @module dashboard */
import { Link } from "@tanstack/react-router";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  Clock3,
  Flag,
  Minus,
  Swords,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useTheme } from "../editor/useTheme";
import { GlobalNav } from "../navigation/GlobalNav";
import fire from "./fire.svg";
import embers from "./embers.svg";
import "./dashboard-demo.css";

const today = 0;
const scenarios = {
  active: { through: today, days: 7 },
  pending: { through: -1, days: 6 },
  broken: { through: -2, days: 7 },
  new: { through: today, days: 0 },
};

type StreakEvent = {
  day: number;
  kind: "matchPlayed" | "practiceAccepted" | "practiceRejected";
};

/** Each calendar day counts once even when a player submits or plays repeatedly. */
function qualifyingDaysFor(events: StreakEvent[]) {
  return new Set(
    events
      .filter(({ kind }) => kind === "matchPlayed" || kind === "practiceAccepted")
      .map(({ day }) => day),
  );
}
const demoDate = new Date("2026-11-14T00:00:00Z");
const days = Array.from({ length: 7 }, (_, index) => {
  const date = new Date(demoDate);
  date.setUTCDate(date.getUTCDate() - 6 + index);
  const label = date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return { day: today - 6 + index, label, date: date.toISOString().slice(0, 10) };
});
const difficulty = [
  { label: "Easy", solved: 18, color: "success" },
  { label: "Medium", solved: 20, color: "warning" },
  { label: "Hard", solved: 4, color: "error" },
] as const;
const matches = [
  {
    mode: "Showdown",
    opponent: "Mira Chen",
    when: "Fri",
    result: "Win",
    icon: ArrowUpRight,
    tone: "success",
  },
  {
    mode: "Race",
    opponent: "3 players",
    when: "Thu",
    result: "Loss",
    icon: ArrowDownRight,
    tone: "error",
  },
  {
    mode: "Showdown",
    opponent: "Leo Park",
    when: "Tue",
    result: "Draw",
    icon: Minus,
    tone: "neutral",
  },
] as const;

/** Count distinct qualifying calendar days, allowing today to remain open until midnight. */
function streakLength(qualifyingDays: Set<number>, day: number) {
  let cursor = qualifyingDays.has(day) ? day : day - 1;
  const start = cursor;
  while (qualifyingDays.has(cursor)) cursor--;
  return start - cursor;
}

/** Render the local preview without reading or changing player stats. */
export function DashboardDemo() {
  const { preference, setPreference } = useTheme();
  const [scenario, setScenario] = useState<keyof typeof scenarios>("active");
  const { through, days: count } = scenarios[scenario];
  const events: StreakEvent[] = Array.from({ length: count }, (_, index) => ({
    day: through - index,
    kind: index % 3 === 1 ? "matchPlayed" : "practiceAccepted",
  }));
  if (scenario === "pending") events.push({ day: today, kind: "practiceRejected" });
  const qualifyingDays = qualifyingDaysFor(events);
  const isNew = scenario === "new";
  const doneToday = qualifyingDays.has(today);
  const length = streakLength(qualifyingDays, today);
  const best = isNew ? 0 : 12;

  return (
    <>
      <GlobalNav theme={preference} onThemeChange={setPreference} />
      <main className="dashboard-demo">
        <header className="dashboard-title">
          <div>
            <h1>Dashboard</h1>
            <p>{isNew ? "Welcome to Quorem." : "Welcome back, Alex."}</p>
          </div>
          <label className="dashboard-scenario">
            Preview state
            <select
              value={scenario}
              onChange={(event) => setScenario(event.target.value as keyof typeof scenarios)}
            >
              <option value="active">Active streak</option>
              <option value="pending">Today pending</option>
              <option value="broken">Broken streak</option>
              <option value="new">New player</option>
            </select>
          </label>
        </header>

        <div className="dashboard-overview">
          <section
            className="dashboard-panel dashboard-next"
            aria-labelledby="dashboard-next-title"
          >
            <h2 id="dashboard-next-title">
              <BookOpen size={17} /> Practice
            </h2>
            <div className="dashboard-next-content">
              <p className="dashboard-caption">
                {isNew ? "Get started" : "Pick up where you left off"}
              </p>
              <h3>{isNew ? "Find your first problem" : "Level Spreads"}</h3>
              {!isNew && (
                <p className="dashboard-next-meta">
                  <span>Medium</span>
                  <span>Binary trees</span>
                </p>
              )}
            </div>
            <div className="dashboard-actions">
              {isNew ? (
                <Link className="button button-primary" to="/practice">
                  Find a problem <ArrowRight size={16} />
                </Link>
              ) : (
                <>
                  <Link
                    className="button button-primary"
                    to="/practice/$slug"
                    params={{ slug: "level-spreads" }}
                  >
                    Resume practice <ArrowRight size={16} />
                  </Link>
                  <Link className="dashboard-link" to="/practice">
                    Browse problems
                  </Link>
                </>
              )}
            </div>
          </section>

          <section
            className="dashboard-panel dashboard-streak"
            aria-labelledby="dashboard-streak-title"
            data-active={length > 0}
          >
            <h2 id="dashboard-streak-title">
              <CalendarDays size={17} /> Daily streak
            </h2>
            <div className="dashboard-streak-summary" aria-live="polite">
              <div>
                <p className="dashboard-streak-number">
                  <strong>{length}</strong> {length === 1 ? "day" : "days"}
                </p>
                <p className="dashboard-caption">
                  {doneToday
                    ? "Today complete"
                    : length
                      ? "Today still open"
                      : isNew
                        ? "Start your streak today"
                        : "Start a new streak today"}
                </p>
              </div>
              <img src={length ? fire : embers} alt="" width={76} height={82} />
            </div>
            <ol className="dashboard-week" aria-label="Last seven days">
              {days.map(({ day, label, date }) => {
                const complete = qualifyingDays.has(day);
                return (
                  <li key={day}>
                    <time dateTime={date}>{label}</time>
                    <span className="dashboard-day" data-done={complete} data-today={day === today}>
                      <span className="sr-only">
                        {complete
                          ? "Complete"
                          : day === today
                            ? "Today pending"
                            : "No qualifying activity"}
                      </span>
                      {complete ? (
                        <Check size={16} aria-hidden="true" />
                      ) : (
                        <span aria-hidden="true">·</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="dashboard-streak-footer">
              <p>Play a match or submit an accepted practice solution.</p>
              <span>
                Best <strong>{best} days</strong>
              </span>
            </div>
          </section>
        </div>

        <div className="dashboard-sections">
          <section className="dashboard-panel" aria-labelledby="dashboard-solves-title">
            <div className="dashboard-panel-heading">
              <h2 id="dashboard-solves-title">
                <Check size={17} /> Problems solved
              </h2>
              <Link className="dashboard-link" to="/practice">
                Practice <ArrowRight size={14} />
              </Link>
            </div>
            <p className="dashboard-total">
              <strong>{isNew ? 0 : 42}</strong> unique problems
            </p>
            <div className="dashboard-solve-bar" aria-hidden="true">
              {!isNew &&
                difficulty.map(({ label, color, solved }) => (
                  <span key={label} data-tone={color} style={{ flexGrow: solved }} />
                ))}
            </div>
            <ul className="dashboard-difficulty">
              {difficulty.map(({ label, solved, color }) => (
                <li key={label}>
                  <span className="dashboard-dot" data-tone={color} />
                  {label}
                  <strong>{isNew ? 0 : solved}</strong>
                </li>
              ))}
            </ul>
          </section>

          <section
            className="dashboard-panel dashboard-matches"
            aria-labelledby="dashboard-matches-title"
          >
            <div className="dashboard-panel-heading">
              <h2 id="dashboard-matches-title">
                <Swords size={17} /> Competition
              </h2>
              <Link className="dashboard-link" to="/practice" search={{ create: "match" }}>
                Create match <ArrowRight size={14} />
              </Link>
            </div>
            {isNew ? (
              <p className="dashboard-caption">Play your first match to build your record.</p>
            ) : (
              <>
                <div className="dashboard-record">
                  <span>
                    <strong>14</strong> wins
                  </span>
                  <span>
                    <strong>3</strong> draws
                  </span>
                  <span>
                    <strong>8</strong> losses
                  </span>
                  <span className="dashboard-caption">Last 30 days</span>
                </div>
                <ul className="dashboard-rows" aria-label="Recent matches">
                  {matches
                    .filter(({ when }) => scenario !== "broken" || when !== "Fri")
                    .map(({ mode, opponent, when, result, icon: Icon, tone }) => (
                      <li key={opponent}>
                        <span>
                          <strong>{mode}</strong>
                          <small>{opponent}</small>
                        </span>
                        <span className="dashboard-match-result" data-tone={tone}>
                          <Icon size={15} />
                          {result}
                        </span>
                        <time>{when}</time>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </section>

          <section className="dashboard-panel" aria-labelledby="dashboard-odyssey-title">
            <div className="dashboard-panel-heading">
              <h2 id="dashboard-odyssey-title">
                <Flag size={17} /> Odysseys
              </h2>
              <Link className="dashboard-link" to="/practice" search={{ type: "odyssey" }}>
                Browse <ArrowRight size={14} />
              </Link>
            </div>
            {isNew ? (
              <p className="dashboard-caption">
                Solve a series of questions that build on each other.
              </p>
            ) : (
              <>
                <p className="dashboard-preview-title">Transit Operations</p>
                <p className="dashboard-caption">Stage 2 of 3 · 4 Odysseys completed</p>
                <ol className="dashboard-stages" aria-label="Odyssey stages">
                  <li data-stage="complete">
                    <Check size={14} />
                    <span className="sr-only">Stage 1 complete</span>
                  </li>
                  <li aria-current="step">
                    2<span className="sr-only">, current stage</span>
                  </li>
                  <li>
                    3<span className="sr-only">, upcoming stage</span>
                  </li>
                </ol>
              </>
            )}
          </section>

          <section className="dashboard-panel" aria-labelledby="dashboard-interviews-title">
            <div className="dashboard-panel-heading">
              <h2 id="dashboard-interviews-title">
                <Users size={17} /> Interviews
              </h2>
              <Link className="dashboard-link" to="/interviews">
                Open interviews <ArrowRight size={14} />
              </Link>
            </div>
            {isNew ? (
              <p className="dashboard-caption">Create a room for a mock interview.</p>
            ) : (
              <>
                <p className="dashboard-preview-title">Mock interview with Mira</p>
                <p className="dashboard-caption dashboard-inline">
                  <Clock3 size={14} /> Last opened yesterday
                </p>
                <p className="dashboard-caption">2 rooms</p>
              </>
            )}
          </section>
          <section
            className="dashboard-panel dashboard-activity"
            aria-labelledby="dashboard-activity-title"
          >
            <div className="dashboard-panel-heading">
              <h2 id="dashboard-activity-title">
                <Clock3 size={17} /> Recent activity
              </h2>
            </div>
            {isNew ? (
              <p className="dashboard-caption">
                Your judged submissions and matches will appear here.
              </p>
            ) : (
              <ul className="dashboard-rows">
                {doneToday && (
                  <li>
                    <span>
                      <strong>Mirror Letters</strong>
                      <small>Practice accepted</small>
                    </span>
                    <time>Today</time>
                  </li>
                )}
                {scenario !== "broken" && (
                  <li>
                    <span>
                      <strong>Showdown</strong>
                      <small>Won against Mira Chen</small>
                    </span>
                    <time>Fri</time>
                  </li>
                )}
                <li>
                  <span>
                    <strong>Race</strong>
                    <small>Played with 3 players</small>
                  </span>
                  <time>Thu</time>
                </li>
              </ul>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
