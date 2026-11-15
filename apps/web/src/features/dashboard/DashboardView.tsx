/** @file DashboardView.tsx @description Shared player dashboard layout for live data and fixture previews. */
import type { DevelopmentIdentity, PlayerDashboard } from "@quorem/contracts";
import { defaultCatalogFormat } from "@quorem/contracts/catalog-filter";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Check, PencilLine, Swords } from "lucide-react";
import type { ReactNode } from "react";
import { DifficultyLabel } from "../../ui/DifficultyLabel";
import { OdysseyIcon } from "../../ui/OdysseyIcon";
import { QuestionTopics } from "../practice/QuestionRowMetadata";
import { PracticeRecommendations } from "../practice/PracticeRecommendations";
import { DashboardTimeline, DashboardDistribution } from "./DashboardHighlights";
import { ActivityCalendar } from "./ActivityCalendar";
import "./dashboard-demo.css";

const recommendationScope = { type: defaultCatalogFormat } as const;

export function DashboardView({
  data,
  name,
  actor,
  controls,
}: {
  data: PlayerDashboard;
  name: string;
  actor?: DevelopmentIdentity;
  controls?: ReactNode;
}) {
  const { practice, odyssey, odysseysCompleted, solved, matches } = data;
  const activity = new Map(
    data.activity.map(({ day, practice, matches }) => [day, { practice, matches }]),
  );
  const solvedTotal = solved.easy + solved.medium + solved.hard;
  const matchTotal = matches.victory + matches.draw + matches.loss;
  const difficulty = [
    { label: "Easy", count: solved.easy, tone: "success" },
    { label: "Medium", count: solved.medium, tone: "warning" },
    { label: "Hard", count: solved.hard, tone: "error" },
  ];
  const matchRecord = [
    { label: "Wins", count: matches.victory, tone: "success" },
    { label: "Draws", count: matches.draw, tone: "neutral" },
    { label: "Losses", count: matches.loss, tone: "error" },
  ];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

  return (
    <main className="dashboard-demo">
      <header className="dashboard-title">
        <h1>
          Good {greeting}, {name}
        </h1>
        {controls}
      </header>

      <section className="dashboard-panel dashboard-next" aria-labelledby="dashboard-next-title">
        <div className="dashboard-panel-heading">
          <h2 id="dashboard-next-title">
            <BookOpen size={17} /> Practice
          </h2>
          <Link className="dashboard-link" to="/practice">
            Browse problems <ArrowRight size={14} />
          </Link>
        </div>
        <div className="dashboard-practice-items">
          {practice && (
            <section className="dashboard-practice-resume" aria-labelledby="dashboard-resume-title">
              <h3 id="dashboard-resume-title">
                <PencilLine size={16} aria-hidden /> In progress
              </h3>
              <div className="dashboard-practice-problem">
                <div>
                  <div className="dashboard-practice-title">
                    <h4>{practice.title}</h4>
                    <DifficultyLabel difficulty={practice.difficulty} />
                  </div>
                  <QuestionTopics tags={practice.tags} linkToFilter />
                </div>
                <Link
                  className="button button-primary"
                  to="/practice/$slug"
                  params={{ slug: practice.slug }}
                >
                  Resume practice <ArrowRight size={16} />
                </Link>
              </div>
            </section>
          )}
          <PracticeRecommendations
            key={actor}
            actor={actor}
            scope={recommendationScope}
            embedded
            primaryAction={!practice}
          />
        </div>
      </section>

      <div className="dashboard-columns">
        <div className="dashboard-overview">
          <ActivityCalendar activity={activity} streakDays={data.streakDays} />
          <section className="dashboard-panel" aria-labelledby="dashboard-odyssey-title">
            <div className="dashboard-panel-heading">
              <h2 id="dashboard-odyssey-title">
                <OdysseyIcon /> Odysseys
              </h2>
              <Link className="dashboard-link" to="/practice" search={{ type: "odyssey" }}>
                Browse Odysseys <ArrowRight size={14} />
              </Link>
            </div>
            {odyssey ? (
              <>
                <p className="dashboard-preview-title">
                  <Link to="/practice/$slug" params={{ slug: odyssey.slug }}>
                    {odyssey.title}
                  </Link>
                  <DifficultyLabel difficulty={odyssey.difficulty} />
                </p>
                <ol className="dashboard-stages" aria-label="Odyssey stages">
                  {Array.from({ length: odyssey.stages }, (_, index) => {
                    const stage = index + 1;
                    const done = stage < odyssey.stage;
                    return (
                      <li
                        key={stage}
                        data-stage={done ? "complete" : undefined}
                        aria-current={stage === odyssey.stage ? "step" : undefined}
                      >
                        {done ? (
                          <>
                            <Check size={14} />
                            <span className="sr-only">Stage {stage} complete</span>
                          </>
                        ) : (
                          stage
                        )}
                      </li>
                    );
                  })}
                </ol>
              </>
            ) : odysseysCompleted === 0 ? (
              <p className="dashboard-caption">
                Solve a series of questions that build on each other.
              </p>
            ) : null}
            {odysseysCompleted > 0 && (
              <p className="dashboard-caption dashboard-odyssey-completed">
                <strong>{odysseysCompleted}</strong>{" "}
                {odysseysCompleted === 1 ? "Odyssey" : "Odysseys"} completed
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
              <strong>{solvedTotal}</strong> problems
            </p>
            <DashboardDistribution label="Solved problems by difficulty" items={difficulty} />
            <section
              className="dashboard-solved-topics"
              aria-labelledby="dashboard-solved-topics-title"
            >
              <h3 id="dashboard-solved-topics-title">Most solved topics</h3>
              {!data.topics.length ? (
                <p className="dashboard-caption">Solve a problem to start tracking topics.</p>
              ) : (
                <ol>
                  {data.topics.map(({ topic, count }) => (
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
            {!matchTotal ? (
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
          <DashboardTimeline items={data.recent} />
        </aside>
      </div>
    </main>
  );
}
