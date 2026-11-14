/** @file DashboardHighlights.tsx @description Player highlights, streak, question metadata, and stat charts. @module dashboard */
import { BookOpen, Flag, Swords } from "lucide-react";
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

const highlightKinds = {
  practiceAccepted: { label: "Latest solve", Icon: BookOpen },
  matchPlayed: { label: "Latest match", Icon: Swords },
  odyssey: { label: "Odyssey milestone", Icon: Flag },
} as const;

type Highlight = { day: number; kind: keyof typeof highlightKinds; title: string; detail: string };

export function DashboardRecentHighlights({ items }: { items: readonly Highlight[] }) {
  if (!items.length) return null;
  const today = new Date();
  return (
    <section
      className="dashboard-panel dashboard-recent-highlights"
      aria-labelledby="dashboard-highlights-title"
    >
      <h2 id="dashboard-highlights-title">Highlights</h2>
      <ul>
        {items.map(({ day, kind, title, detail }) => {
          const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + day);
          const { label, Icon } = highlightKinds[kind];
          const dateTime = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
            .map((part) => String(part).padStart(2, "0"))
            .join("-");
          return (
            <li key={kind}>
              <span className="dashboard-highlight-kind">
                <Icon size={14} aria-hidden="true" /> {label}
              </span>
              <strong>{title}</strong>
              <p>
                {detail} ·{" "}
                <time dateTime={dateTime}>{day === 0 ? "Today" : activityDate.format(date)}</time>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
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
