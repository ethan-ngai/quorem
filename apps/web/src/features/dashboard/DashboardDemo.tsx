/** @file DashboardDemo.tsx @description Fixture-backed player dashboard and streak states. @module dashboard */
import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Check, Clock3, Flag, Swords, Users } from "lucide-react";
import { useState } from "react";
import { SelectField } from "../../ui/SelectField";
import { useTheme } from "../editor/useTheme";
import { GlobalNav } from "../navigation/GlobalNav";
import {
  DashboardActivity,
  DashboardDistribution,
  DashboardRecommendations,
  DashboardQuestionMetadata,
  DashboardStreak,
} from "./DashboardHighlights";
import "./dashboard-demo.css";

const today = 0;
const scenarios = {
  active: { through: today, days: 7 },
  pending: { through: -1, days: 6 },
  broken: { through: -2, days: 7 },
  new: { through: today, days: 0 },
};

const scenarioOptions = [
  { value: "active", label: "Active streak" },
  { value: "pending", label: "Today pending" },
  { value: "broken", label: "Broken streak" },
  { value: "new", label: "New player" },
];

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
  { slug: "segment-sums", title: "Segment Sums", difficulty: "medium", tags: ["Linked List"] },
  {
    slug: "quota-window",
    title: "Quota Window",
    difficulty: "hard",
    tags: ["Strings", "Sliding Window"],
  },
] as const;

const difficulty = [
  { label: "Easy", count: 18, tone: "success" },
  { label: "Medium", count: 20, tone: "warning" },
  { label: "Hard", count: 4, tone: "error" },
] as const;
const matchRecord = [
  { label: "Wins", count: 14, tone: "success" },
  { label: "Draws", count: 3, tone: "neutral" },
  { label: "Losses", count: 8, tone: "error" },
];
const matchTotal = matchRecord.reduce((total, { count }) => total + count, 0);
const matches = [
  {
    mode: "Showdown",
    opponent: "Mira Chen",
    when: "Fri",
    result: "Win",
  },
  {
    mode: "Race",
    opponent: "3 players",
    when: "Thu",
    result: "Loss",
  },
  {
    mode: "Showdown",
    opponent: "Leo Park",
    when: "Tue",
    result: "Draw",
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
  const recentMatches = matches.filter(({ when }) => scenario !== "broken" || when !== "Fri");
  const activity = isNew
    ? []
    : [
        ...(doneToday
          ? [
              {
                id: "mirror-letters",
                title: "Mirror Letters",
                detail: "Practice accepted",
                when: "Today",
                kind: "practice" as const,
              },
            ]
          : []),
        ...recentMatches.map(({ mode, opponent, result, when }) => ({
          id: opponent,
          title: mode,
          detail: `${result} · ${opponent}`,
          when,
          kind: "match" as const,
        })),
      ];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  return (
    <>
      <GlobalNav theme={preference} onThemeChange={setPreference} />
      <main className="dashboard-demo">
        <header className="dashboard-title">
          <h1>Good {greeting}, Alex.</h1>
          <SelectField
            label="Preview state"
            value={scenario}
            options={scenarioOptions}
            onChange={(value) => setScenario(value as keyof typeof scenarios)}
          />
        </header>

        <div className="dashboard-top">
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
                <DashboardQuestionMetadata
                  difficulty="medium"
                  tags={["Binary Trees", "Breadth-First Search"]}
                />
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
          <DashboardStreak days={length} />
        </div>

        <div className="dashboard-columns">
          <div className="dashboard-main">
            <DashboardRecommendations items={recommendations} />
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
            <DashboardActivity items={activity} />
          </div>
          <aside className="dashboard-progress" aria-label="Progress">
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
              <DashboardDistribution
                label="Solved problems by difficulty"
                items={isNew ? difficulty.map((item) => ({ ...item, count: 0 })) : difficulty}
              />
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
                  <p className="dashboard-total">
                    <strong>{matchTotal}</strong> matches in the last 30 days
                  </p>
                  <DashboardDistribution items={matchRecord} label="Match outcomes" />
                </>
              )}
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
