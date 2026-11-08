/** @file PracticeRecommendations.tsx @description One visible recommendation above the practice catalog. @module practice */
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Lightbulb, X } from "lucide-react";
import { api } from "../../api/client";
import { formatLabel } from "../../ui/formatLabel";
import { LoadingIndicator } from "../../ui/Spinner";
import { Tooltip } from "../../ui/Tooltip";
import { warmWorkspacePage } from "../editor/preloadWorkspace";
import type { CatalogSearch } from "./catalogSearch";
import { catalogQueryOptions, type ProblemActor } from "./problemQueries";
import { QuestionTopics } from "./QuestionRowMetadata";
import { QuestionIndicators } from "./QuestionIndicators";
import "../../ui/difficulty.css";
import "./practice-recommendations.css";

const reasonLabels = {
  review: "Due for review",
  weak_topic: "Strengthen a topic",
  new_topic: undefined,
  challenge: "Build your skills",
  practice: "Keep practicing",
};

export function PracticeRecommendations({
  actor,
  library,
}: {
  actor: ProblemActor;
  library: CatalogSearch["library"];
}) {
  const heading = useId();
  const client = useQueryClient();
  const options = catalogQueryOptions(client, actor, { library, sort: "recommended", limit: 5 });
  const recommendations = useQuery(options);
  const items = recommendations.data?.items;
  const viewport = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const count = items?.length ?? 0;
  const active = Math.max(0, Math.min(index, count - 1));
  const item = items?.[active];
  const impression = item && recommendations.data?.recommendationImpressions?.[item.id];

  useEffect(() => {
    if (!actor || actor === "anonymous" || !impression) return;
    const slide = viewport.current?.children[active];
    if (!slide) return;
    // Attribute only the card actually visible on screen.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio < 0.95) return;
        observer.disconnect();
        void api(actor)
          .POST("/v1/recommendation-feedback", { body: { action: "view", ids: [impression] } })
          .catch(() => {});
      },
      { threshold: 0.95 },
    );
    observer.observe(slide);
    return () => observer.disconnect();
  }, [active, actor, impression]);

  const dismissal = useMutation({
    mutationFn: async (id: string) => {
      if (!actor || actor === "anonymous") return;
      const { response } = await api(actor).POST("/v1/recommendation-feedback", {
        body: { action: "dismiss", ids: [id] },
      });
      if (!response.ok) throw new Error("Dismissal failed");
    },
    onSuccess: () => client.invalidateQueries({ queryKey: options.queryKey }),
  });

  const move = (offset: number) => {
    const track = viewport.current;
    const next = active + offset;
    if (!track || next < 0 || next >= count) return;
    track.scrollTo({ left: next * track.clientWidth });
  };

  if (!count && recommendations.isSuccess && !recommendations.isError) return null;
  return (
    <section
      className="practice-recommendations"
      aria-labelledby={heading}
      aria-roledescription="carousel"
    >
      <div className="practice-recommendations-header">
        <h2 id={heading}>
          <Lightbulb size={16} aria-hidden /> Recommended
        </h2>
        {count > 1 && (
          <div className="practice-recommendations-controls">
            <span aria-hidden="true">
              {active + 1} / {count}
            </span>
            <span className="sr-only" aria-live="polite" aria-atomic="true">
              {item?.title}, {active + 1} of {count}
            </span>
            <Tooltip content="Previous recommendation">
              <button
                className="icon-button"
                type="button"
                aria-label="Previous recommendation"
                aria-disabled={active === 0}
                onClick={() => move(-1)}
              >
                <ChevronLeft size={16} aria-hidden />
              </button>
            </Tooltip>
            <Tooltip content="Next recommendation">
              <button
                className="icon-button"
                type="button"
                aria-label="Next recommendation"
                aria-disabled={active === count - 1}
                onClick={() => move(1)}
              >
                <ChevronRight size={16} aria-hidden />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
      {item ? (
        <>
          <div
            ref={viewport}
            className="practice-recommendations-track"
            tabIndex={0}
            role="group"
            aria-label="Recommendation cards"
            onScroll={({ currentTarget }) => {
              setIndex(Math.round(currentTarget.scrollLeft / currentTarget.clientWidth));
            }}
            onKeyDown={(event) => {
              if (event.altKey || event.ctrlKey || event.metaKey) return;
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                if (event.target !== event.currentTarget)
                  event.currentTarget.focus({ preventScroll: true });
                move(event.key === "ArrowRight" ? 1 : -1);
              }
            }}
          >
            {items?.map((question, position) => {
              const id = recommendations.data?.recommendationImpressions?.[question.id];
              const reason =
                question.recommendationReason && reasonLabels[question.recommendationReason];
              return (
                <div
                  key={question.id}
                  className="practice-recommendation-slide"
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${position + 1} of ${count}`}
                  inert={position !== active}
                  aria-hidden={position !== active || undefined}
                >
                  <div className="practice-recommendation-details">
                    <div className="practice-recommendation-title">
                      <h3>{question.title}</h3>
                      <span className={`difficulty-${question.difficulty}`}>
                        {formatLabel(question.difficulty)}
                      </span>
                      <QuestionIndicators
                        privateQuestion={!!question.isPrivate}
                        odyssey={!!question.odyssey}
                      />
                    </div>
                    <div className="practice-recommendation-meta">
                      <QuestionTopics tags={question.tags} />
                      {reason && <span>{reason}</span>}
                    </div>
                  </div>
                  <div className="practice-recommendation-actions">
                    <Link
                      className="button button-secondary"
                      to="/practice/$slug"
                      params={{ slug: question.slug }}
                      onPointerEnter={warmWorkspacePage}
                      onFocus={warmWorkspacePage}
                    >
                      Start practice
                    </Link>
                    {id && (
                      <Tooltip content="Hide recommendation for 7 days">
                        <button
                          className="icon-button"
                          type="button"
                          aria-label={`Hide recommendation for ${question.title}`}
                          disabled={dismissal.isPending}
                          onClick={() => {
                            viewport.current?.focus({ preventScroll: true });
                            dismissal.mutate(id);
                          }}
                        >
                          <X size={16} aria-hidden />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {dismissal.isError && (
            <p className="practice-recommendations-status" role="alert">
              Couldn’t hide this recommendation. Try again.
            </p>
          )}
        </>
      ) : recommendations.isError ? (
        <div className="practice-recommendations-status" role="alert">
          Recommendations couldn’t load.
          <button
            className="practice-retry"
            type="button"
            onClick={() => void recommendations.refetch()}
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="practice-recommendations-status">
          <LoadingIndicator label="Loading recommendations…" />
        </div>
      )}
    </section>
  );
}
