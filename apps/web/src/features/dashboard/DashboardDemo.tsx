/** @file DashboardDemo.tsx @description Fixture-backed player dashboard and streak states. @module dashboard */
import { useState } from "react";
import { SelectField } from "../../ui/SelectField";
import { useTheme } from "../editor/useTheme";
import { useAccountIdentity } from "../matches/MatchControls";
import { sampleActiveStreakDays } from "../activity/streakFixtures";
import { GlobalNav } from "../navigation/GlobalNav";
import { DashboardView } from "./DashboardView";
import { activityHistoryDays, summarizeActivity } from "./ActivityCalendar";

const today = 0;
const scenarios = {
  active: { through: today, days: sampleActiveStreakDays },
  pending: { through: -1, days: 6 },
  broken: { through: -2, days: 7 },
  new: { through: today, days: 0 },
  noPractice: { through: today, days: sampleActiveStreakDays },
  noOdyssey: { through: today, days: sampleActiveStreakDays },
  caughtUp: { through: today, days: sampleActiveStreakDays },
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

const mostSolvedTopics = [
  { topic: "Binary Trees", count: 12 },
  { topic: "Sliding Window", count: 9 },
  { topic: "Linked List", count: 7 },
] as const;
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
const sampleMatchModes = ["showdown", "factions", "free-for-all"] as const;
const sampleOpponents = ["Mira Chen", "Leo Park", "Nora Shah"];

/** Keep sample highlight titles attached to the events that qualify for streaks. */
function sampleActivity(index: number, match: boolean) {
  return match
    ? {
        kind: "matchPlayed" as const,
        mode: sampleMatchModes[Math.floor(index / 2) % sampleMatchModes.length],
        title: sampleProblems[index % sampleProblems.length].title,
        opponents:
          index % 6 === 4 ? sampleOpponents : [sampleOpponents[index % sampleOpponents.length]],
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
    ...sampleActivity(index, index % 3 === 1 || index === 3),
  }));
  const qualifyingDays = summarizeActivity(scenario === "new" ? [] : [...sampleHistory, ...events]);
  const isNew = scenario === "new";
  const length = streakLength(qualifyingDays, today);
  const hasPractice = !isNew && scenario !== "noPractice" && scenario !== "caughtUp";
  const hasOdyssey = !isNew && scenario !== "noOdyssey" && scenario !== "caughtUp";
  const timeline = isNew
    ? []
    : [
        ...events.filter(({ day }) => day !== through - 2),
        {
          kind: "odyssey" as const,
          day: through - 2,
          title: "Transit Operations",
          difficulty: "medium" as const,
        },
      ]
        .sort((a, b) => b.day - a.day)
        .slice(0, 5);
  return (
    <>
      <GlobalNav theme={preference} onThemeChange={setPreference} />
      <DashboardView
        name="Alex"
        actor={actor}
        data={{
          streakDays: length,
          activity: [...qualifyingDays].map(([day, counts]) => ({ day, ...counts })),
          practice: hasPractice
            ? { ...practiceInProgress, tags: [...practiceInProgress.tags] }
            : null,
          odyssey: hasOdyssey
            ? {
                slug: "transit-operations",
                title: "Transit Operations",
                difficulty: "medium",
                stages: 3,
                stage: 2,
              }
            : null,
          solved: isNew ? { easy: 0, medium: 0, hard: 0 } : { easy: 18, medium: 20, hard: 4 },
          matches: isNew ? { victory: 0, draw: 0, loss: 0 } : { victory: 14, draw: 3, loss: 8 },
          odysseysCompleted: isNew ? 0 : 4,
          topics: isNew ? [] : [...mostSolvedTopics],
          recent: timeline.map((item, index) => ({ ...item, id: String(index) })),
        }}
        controls={
          <SelectField
            label="Preview state"
            value={scenario}
            options={scenarioOptions}
            onChange={(value) => setScenario(value as keyof typeof scenarios)}
          />
        }
      />
    </>
  );
}
