/** @file DashboardHighlights.tsx @description Streak summary and compact dashboard lists. @module dashboard */
import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Check, Clock3, Lightbulb, Swords } from "lucide-react";
import type { ReactNode } from "react";
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

/** Align titles and metadata across dashboard lists with different row interactions. */
function HighlightRow({
  icon,
  title,
  detail,
  trailing,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  trailing: ReactNode;
}) {
  return (
    <>
      <span className="dashboard-highlight-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="dashboard-highlight-copy">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <span className="dashboard-highlight-meta">{trailing}</span>
    </>
  );
}

export function DashboardRecommendations({ items }: { items: readonly Recommendation[] }) {
  return (
    <section className="dashboard-panel" aria-labelledby="dashboard-recommendations-title">
      <h2 id="dashboard-recommendations-title">
        <Lightbulb aria-hidden="true" /> Recommended for you
      </h2>
      <ul className="dashboard-highlights">
        {items.map(({ slug, title, topic, difficulty }) => (
          <li key={slug}>
            <Link className="dashboard-highlight-row" to="/practice/$slug" params={{ slug }}>
              <HighlightRow
                icon={<BookOpen size={16} />}
                title={title}
                detail={topic}
                trailing={
                  <>
                    <DifficultyLabel difficulty={difficulty} />
                    <ArrowRight size={14} aria-hidden="true" />
                  </>
                }
              />
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
        <ul className="dashboard-highlights">
          {items.map(({ id, title, detail, when, kind }) => (
            <li key={id} className="dashboard-highlight-row">
              <HighlightRow
                icon={kind === "practice" ? <Check size={16} /> : <Swords size={16} />}
                title={title}
                detail={detail}
                trailing={when}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="dashboard-highlight-empty dashboard-caption">
          Your judged submissions and matches will appear here.
        </p>
      )}
    </section>
  );
}

export function DashboardStreak({
  days,
  best,
  doneToday,
}: {
  days: number;
  best: number;
  doneToday: boolean;
}) {
  const status = doneToday
    ? "Today complete"
    : days
      ? "Today pending"
      : best
        ? "Streak reset"
        : "Ready to start";
  return (
    <section className="dashboard-streak" aria-labelledby="dashboard-streak-title">
      <h2 id="dashboard-streak-title">Daily streak</h2>
      <div className="dashboard-streak-summary" aria-live="polite">
        <img src={days ? fire : embers} alt="" width={64} height={64} />
        <div>
          <p className="dashboard-streak-number">
            <strong>{days}</strong> {days === 1 ? "day" : "days"}
          </p>
          <p className="dashboard-caption" data-complete={doneToday}>
            {doneToday && <Check size={14} aria-hidden="true" />}
            {status}
          </p>
        </div>
      </div>
      <div className="dashboard-streak-footer">
        <p>Play a match or get a practice submission accepted.</p>
        <p>
          Best{" "}
          <strong>
            {best} {best === 1 ? "day" : "days"}
          </strong>
        </p>
      </div>
    </section>
  );
}
