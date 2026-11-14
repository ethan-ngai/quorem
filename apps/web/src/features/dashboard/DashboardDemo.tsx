/** @file DashboardDemo.tsx @description Fixture-backed player dashboard and streak states. @module dashboard */
import { Link } from "@tanstack/react-router";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Clock3,
  Flag,
  Lightbulb,
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
const recommendations = [
  { slug: "segment-sums", title: "Segment Sums", difficulty: "Medium", topic: "Arrays" },
  { slug: "quota-window", title: "Quota Window", difficulty: "Hard", topic: "Sliding window" },
] as const;

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
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  return (
    <>
      <GlobalNav theme={preference} onThemeChange={setPreference} />
      <main className="dashboard-demo">
        <header className="dashboard-title">
          <h1>
            Good {greeting},<br /> Alex.
          </h1>
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

        <section
          className="dashboard-panel dashboard-solves"
          aria-labelledby="dashboard-solves-title"
        >
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

        <div className="dashboard-columns">
          <div className="dashboard-main">
            <section
              className="dashboard-panel dashboard-next"
              aria-labelledby="dashboard-next-title"
            >
              <h2 id="dashboard-next-title">
                <BookOpen size={17} /> Practice
              </h2>
              <div className="dashboard-next-content">
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
              className="dashboard-panel dashboard-recommendations"
              aria-labelledby="dashboard-recommendations-title"
            >
              <h2 id="dashboard-recommendations-title">
                <Lightbulb size={17} /> Recommended for you
              </h2>
              <ul>
                {recommendations.map(({ slug, title, difficulty, topic }) => (
                  <li key={slug}>
                    <Link to="/practice/$slug" params={{ slug }}>
                      <span>
                        <strong>{title}</strong>
                        <small>{topic}</small>
                      </span>
                      <span className="dashboard-recommendation-difficulty">{difficulty}</span>
                      <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            <div className="dashboard-destinations">
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
            </div>
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
          <aside className="dashboard-progress" aria-label="Progress">
            <section
              className="dashboard-streak"
              aria-labelledby="dashboard-streak-title"
              data-active={length > 0}
            >
              <div aria-live="polite">
                <h2 id="dashboard-streak-title">{length ? "Daily streak" : "No active streak"}</h2>
                <p className="dashboard-caption">
                  {doneToday
                    ? "Today complete"
                    : length
                      ? "Today still open"
                      : "Start a streak today"}
                </p>
                <div className="dashboard-streak-summary">
                  <p className="dashboard-streak-number">
                    <strong>{length}</strong>
                    <span>{length === 1 ? "day active" : "days active"}</span>
                  </p>
                  <img src={length ? fire : embers} alt="" width={144} height={144} />
                </div>
              </div>
              <div className="dashboard-streak-footer">
                <p>Play a match or submit an accepted practice solution.</p>
                <span>
                  Best <strong>{best} days</strong>
                </span>
              </div>
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
          </aside>
        </div>
      </main>
    </>
  );
}
