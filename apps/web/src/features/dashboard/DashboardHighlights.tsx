/** @file DashboardHighlights.tsx @description Streak, question metadata, and stat charts. @module dashboard */
import { BookOpen, Swords } from "lucide-react";
import type { ActivityEvent } from "./ActivityCalendar";
import { DifficultyLabel } from "../../ui/DifficultyLabel";
import { QuestionTopics } from "../practice/QuestionRowMetadata";
import { useState } from "react";
import { StreakArtwork } from "./StreakArtwork";

type QuestionMetadata = {
  difficulty: Parameters<typeof DifficultyLabel>[0]["difficulty"];
  tags: readonly string[];
};

export function DashboardQuestionMetadata({ difficulty, tags }: QuestionMetadata) {
  return (
    <div className="dashboard-question-meta">
      <DifficultyLabel difficulty={difficulty} />
      <QuestionTopics tags={tags} />
    </div>
  );
}

const activityDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export function DashboardActivity({
  items,
}: {
  items: readonly (ActivityEvent & { title: string; detail: string })[];
}) {
  if (!items.length) return null;
  const today = new Date();
  return (
    <details className="dashboard-recent-activity">
      <summary>Recent activity</summary>
      <ul>
        {items.map(({ day, kind, title, detail }) => {
          const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + day);
          const Icon = kind === "matchPlayed" ? Swords : BookOpen;
          return (
            <li key={day}>
              <Icon size={14} aria-hidden="true" />
              <span>
                <strong>{title}</strong> · {detail}
              </span>
              <span>{day === 0 ? "Today" : activityDate.format(date)}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function DashboardStreak({ days }: { days: number }) {
  const [replay, setReplay] = useState(0);
  return (
    <section className="dashboard-streak" aria-labelledby="dashboard-streak-title">
      <h2 id="dashboard-streak-title">Daily streak</h2>
      <div className="dashboard-streak-summary" aria-live="polite">
        <button
          type="button"
          className="dashboard-streak-art"
          aria-label="Replay streak animation"
          onClick={() => setReplay((count) => count + 1)}
        >
          <StreakArtwork key={`${days}:${replay}`} active={days > 0} />
        </button>
        <p className="dashboard-streak-number">
          <strong>{days}</strong> <span>{days === 1 ? "day" : "days"}</span>
        </p>
      </div>
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
