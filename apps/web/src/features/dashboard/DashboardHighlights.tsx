/** @file DashboardHighlights.tsx @description Streak, recommendations, and activity previews. @module dashboard */
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Check, Clock3, Lightbulb, Swords } from "lucide-react";
import { DifficultyLabel } from "../../ui/DifficultyLabel";
import fire from "./fire.svg";
import embers from "./embers.svg";

type Recommendation = {
  slug: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  topic: string;
};

type Activity = {
  id: string;
  title: string;
  detail: string;
  when: string;
  kind: "practice" | "match";
};

export function DashboardRecommendations({ items }: { items: readonly Recommendation[] }) {
  return (
    <section className="dashboard-panel" aria-labelledby="dashboard-recommendations-title">
      <h2 id="dashboard-recommendations-title">
        <Lightbulb aria-hidden="true" /> Recommended for you
      </h2>
      <ul className="dashboard-picks">
        {items.map(({ slug, title, topic, difficulty }) => (
          <li key={slug}>
            <Link to="/practice/$slug" params={{ slug }}>
              <strong>{title}</strong>
              <ArrowUpRight size={14} aria-hidden="true" />
              <small>
                {topic} <span aria-hidden="true">·</span>{" "}
                <DifficultyLabel difficulty={difficulty} />
              </small>
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
  return (
    <section className="dashboard-streak" aria-labelledby="dashboard-streak-title">
      <h2 id="dashboard-streak-title">Daily streak</h2>
      <div className="dashboard-streak-summary" aria-live="polite">
        <img src={days ? fire : embers} alt="" width={64} height={64} />
        <p className="dashboard-streak-number">
          <strong>{days}</strong> {days === 1 ? "day" : "days"}
        </p>
      </div>
    </section>
  );
}
