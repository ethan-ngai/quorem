/** @file DashboardHighlights.tsx @description Streak, recommendations, and activity previews. @module dashboard */
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Check, Clock3, Lightbulb, Swords } from "lucide-react";
import { DifficultyLabel } from "../../ui/DifficultyLabel";
import { QuestionTopics } from "../practice/QuestionRowMetadata";
import { useState } from "react";
import { StreakArtwork } from "./StreakArtwork";

type Recommendation = {
  slug: string;
  title: string;
  difficulty: Parameters<typeof DifficultyLabel>[0]["difficulty"];
  tags: readonly string[];
};

type Activity = {
  id: string;
  title: string;
  detail: string;
  when: string;
  kind: "practice" | "match";
};

export function DashboardQuestionMetadata({
  difficulty,
  tags,
}: Pick<Recommendation, "difficulty" | "tags">) {
  return (
    <div className="dashboard-question-meta">
      <DifficultyLabel difficulty={difficulty} />
      <QuestionTopics tags={tags} />
    </div>
  );
}

export function DashboardRecommendations({ items }: { items: readonly Recommendation[] }) {
  return (
    <section className="dashboard-panel" aria-labelledby="dashboard-recommendations-title">
      <h2 id="dashboard-recommendations-title">
        <Lightbulb aria-hidden="true" /> Recommended for you
      </h2>
      <ul className="dashboard-picks">
        {items.map(({ slug, title, tags, difficulty }) => (
          <li key={slug}>
            <Link to="/practice/$slug" params={{ slug }}>
              <strong>{title}</strong>
              <ArrowUpRight size={14} aria-hidden="true" />
              <DashboardQuestionMetadata difficulty={difficulty} tags={tags} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DashboardActivity({ items }: { items: readonly Activity[] }) {
  return (
    <section className="dashboard-panel" aria-labelledby="dashboard-activity-title">
      <h2 id="dashboard-activity-title">
        <Clock3 aria-hidden="true" /> Recent activity
      </h2>
      {items.length ? (
        <ol className="dashboard-activity">
          {items.map(({ id, title, detail, when, kind }) => (
            <li key={id}>
              <span className="dashboard-activity-date">
                {kind === "practice" ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <Swords size={14} aria-hidden="true" />
                )}
                {when}
              </span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </li>
          ))}
        </ol>
      ) : (
        <p className="dashboard-highlight-empty dashboard-caption">
          Your judged submissions and matches will appear here.
        </p>
      )}
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
