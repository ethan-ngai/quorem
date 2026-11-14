/** @file DashboardDemo.tsx @description Fixture-backed player dashboard and streak states. @module dashboard */
import { defaultCatalogFormat } from "@quorem/contracts/catalog-filter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Check, Swords } from "lucide-react";
import { useState } from "react";
import { OdysseyIcon } from "../../ui/OdysseyIcon";
import { SelectField } from "../../ui/SelectField";
import { useTheme } from "../editor/useTheme";
import { useAccountIdentity } from "../matches/MatchControls";
import {
  PracticeRecommendations,
  practiceRecommendationOptions,
} from "../practice/PracticeRecommendations";
import { GlobalNav } from "../navigation/GlobalNav";
import {
  DashboardTimeline,
  DashboardDistribution,
  DashboardQuestionMetadata,
  DashboardStreak,
} from "./DashboardHighlights";
import { ActivityCalendar, activityHistoryDays, summarizeActivity } from "./ActivityCalendar";
import "./dashboard-demo.css";

const today = 0;
const scenarios = {
  active: { through: today, days: 7 },
  pending: { through: -1, days: 6 },
  broken: { through: -2, days: 7 },
  new: { through: today, days: 0 },
  noPractice: { through: today, days: 7 },
  noOdyssey: { through: today, days: 7 },
  caughtUp: { through: today, days: 7 },
};

const scenarioOptions = [
  { value: "active", label: "Active streak" },
  { value: "pending", label: "Today pending" },
  { value: "broken", label: "Broken streak" },
  { value: "new", label: "New player" },
  { value: "noPractice", label: "No practice in progress" },
  { value: "noOdyssey", label: "No Odyssey in progress" },
  { value: "caughtUp", label: "Nothing to resume" },
];

const difficulty = [
  { label: "Easy", count: 18, tone: "success" },
  { label: "Medium", count: 20, tone: "warning" },
  { label: "Hard", count: 4, tone: "error" },
] as const;
const mostSolvedTopics = [
  { topic: "Binary Trees", count: 12 },
  { topic: "Sliding Window", count: 9 },
  { topic: "Linked List", count: 7 },
] as const;
const matchRecord = [
  { label: "Wins", count: 14, tone: "success" },
  { label: "Draws", count: 3, tone: "neutral" },
  { label: "Losses", count: 8, tone: "error" },
];
const matchTotal = matchRecord.reduce((total, { count }) => total + count, 0);
const recommendationScope = { type: defaultCatalogFormat } as const;
const practiceInProgress = {
  slug: "level-spreads",
  title: "Level Spreads",
  difficulty: "medium",
  tags: ["Binary Trees", "Breadth-First Search"],
} as const;
const sampleProblems = [
  { title: "Mirror Letters", difficulty: "easy" },
  { title: "Segment Sums", difficulty: "medium" },
  { title: "Quota Window", difficulty: "hard" },
] as const;
const sampleOpponents = ["Mira Chen", "Leo Park", "Nora Shah"];

/** Keep sample highlight titles attached to the events that qualify for streaks. */
function sampleActivity(index: number, match: boolean) {
  return match
    ? {
        kind: "matchPlayed" as const,
        title:
          index % 6 === 4
            ? "Free-for-all · 4 players"
            : `Showdown vs. ${sampleOpponents[index % sampleOpponents.length]}`,
        outcome: index % 2 ? ("victory" as const) : ("loss" as const),
      }
    : {
        kind: "practiceAccepted" as const,
        ...sampleProblems[index % sampleProblems.length],
      };
}

const sampleHistory = Array.from({ length: activityHistoryDays - 10 }, (_, index) => {
  const day = -10 - index;
  const count = ((index * 41) ^ (index >> 1)) % 7;
  return Array.from({ length: Math.max(0, count - 2) }, (_, event) => ({
    day,
    ...sampleActivity(index + event, (index + event) % 3 === 0),
  }));
}).flat();

/** Count distinct qualifying calendar days, allowing today to remain open until midnight. */
function streakLength(qualifyingDays: ReadonlyMap<number, unknown>, day: number) {
  let cursor = qualifyingDays.has(day) ? day : day - 1;
  const start = cursor;
  while (qualifyingDays.has(cursor)) cursor--;
  return start - cursor;
}

/** Render the local preview without reading or changing player stats. */
export function DashboardDemo() {
  const { preference, setPreference } = useTheme();
  const { identity, account } = useAccountIdentity();
  const actor = account.data === undefined ? undefined : identity;
  const [scenario, setScenario] = useState<keyof typeof scenarios>("active");
  const { through, days: count } = scenarios[scenario];
  const events = Array.from({ length: count }, (_, index) => ({
    day: through - index,
    ...sampleActivity(index, index % 3 === 1),
  }));
  const qualifyingDays = summarizeActivity(scenario === "new" ? [] : [...sampleHistory, ...events]);
  const isNew = scenario === "new";
  const length = streakLength(qualifyingDays, today);
  const hasPractice = !isNew && scenario !== "noPractice" && scenario !== "caughtUp";
  const hasOdyssey = !isNew && scenario !== "noOdyssey" && scenario !== "caughtUp";
  const timeline = isNew
    ? []
    : [
        ...events,
        {
          kind: "odyssey" as const,
          day: -9,
          title: "Transit Operations",
          detail: hasOdyssey ? "Stage 1 cleared" : "Completed",
        },
      ]
        .sort((a, b) => b.day - a.day)
        .slice(0, 5);
  const client = useQueryClient();
  const options = practiceRecommendationOptions(client, actor, recommendationScope);
  const recommended = useQuery({ ...options, enabled: !hasPractice && options.enabled !== false });
  const nextProblem = hasPractice ? practiceInProgress : recommended.data?.items[0];
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
              <h3>{nextProblem?.title ?? "Find a problem"}</h3>
              {nextProblem && (
                <DashboardQuestionMetadata
                  difficulty={nextProblem.difficulty}
                  tags={nextProblem.tags}
                />
              )}
            </div>
            <div className="dashboard-actions">
              {nextProblem && (
                <Link
                  className="button button-primary"
                  to="/practice/$slug"
                  params={{ slug: nextProblem.slug }}
                >
                  {hasPractice ? "Resume practice" : "Start practice"} <ArrowRight size={16} />
                </Link>
              )}
              <Link
                className={nextProblem ? "dashboard-link" : "button button-primary"}
                to="/practice"
              >
                Browse problems
              </Link>
            </div>
          </section>
          <DashboardStreak days={length} />
        </div>

        <ActivityCalendar activity={qualifyingDays} />

        <div className="dashboard-columns">
          <div className="dashboard-main">
            <PracticeRecommendations key={actor} actor={actor} scope={recommendationScope} />
            <section
              className="dashboard-panel dashboard-odyssey"
              aria-labelledby="dashboard-odyssey-title"
            >
              <div className="dashboard-panel-heading">
                <h2 id="dashboard-odyssey-title">
                  <OdysseyIcon /> Odysseys
                </h2>
                <Link className="dashboard-link" to="/practice" search={{ type: "odyssey" }}>
                  Browse Odysseys <ArrowRight size={14} />
                </Link>
              </div>
              {hasOdyssey ? (
                <>
                  <p className="dashboard-preview-title">Transit Operations</p>
                  <p className="dashboard-caption">Stage 2 of 3</p>
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
              ) : isNew ? (
                <p className="dashboard-caption">
                  Solve a series of questions that build on each other.
                </p>
              ) : null}
              {!isNew && (
                <p className="dashboard-caption dashboard-odyssey-completed">
                  <strong>4</strong> Odysseys completed
                </p>
              )}
            </section>
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
                <strong>{isNew ? 0 : 42}</strong> problems
              </p>
              <DashboardDistribution
                label="Solved problems by difficulty"
                items={isNew ? difficulty.map((item) => ({ ...item, count: 0 })) : difficulty}
              />
              <section
                className="dashboard-solved-topics"
                aria-labelledby="dashboard-solved-topics-title"
              >
                <h3 id="dashboard-solved-topics-title">Most solved topics</h3>
                {isNew ? (
                  <p className="dashboard-caption">Solve a problem to start tracking topics.</p>
                ) : (
                  <ol>
                    {mostSolvedTopics.map(({ topic, count }) => (
                      <li key={topic}>
                        <Link className="topic-chip" to="/practice" search={{ topic }}>
                          {topic} <strong>{count}</strong>
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
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
        <DashboardTimeline items={timeline} />
      </main>
    </>
  );
}
