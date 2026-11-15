/** @file PracticeTopicAccordion.tsx @description Topic progress and on-demand practice questions. @module practice */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { LoadingButton } from "../../ui/LoadingButton";
import { LoadingScreen } from "../../ui/LoadingScreen";
import {
  PracticeQuestionTable,
  type PracticeRowFilters,
  type PracticeTableState,
} from "./PracticeQuestionTable";
import {
  catalogPageSize,
  catalogQueryOptions,
  type CatalogPage,
  type CatalogRequest,
  type ProblemActor,
} from "./problemQueries";

type TopicPanelProps = {
  actor: ProblemActor;
  filters: CatalogRequest;
  rowFilters: PracticeRowFilters;
};

function TopicQuestions({ actor, filters, rowFilters }: TopicPanelProps) {
  const client = useQueryClient();
  const [state, setState] = useState<PracticeTableState>({
    page: 1,
    limit: catalogPageSize,
    sort: "title",
    order: "asc",
  });
  const query = useQuery(
    catalogQueryOptions(client, actor, {
      ...filters,
      ...state,
      sort: state.sort === "title" ? undefined : state.sort,
      order: state.order === "asc" ? undefined : state.order,
    }),
  );
  if (query.isPending) return <LoadingScreen inline label="Loading questions…" />;
  if (query.isError)
    return (
      <div className="practice-state" role="alert">
        <p>Questions couldn’t load.</p>
        <LoadingButton
          className="button button-secondary"
          pending={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Retry
        </LoadingButton>
      </div>
    );
  return (
    <PracticeQuestionTable
      data={query.data}
      placeholder={query.isPlaceholderData}
      fetching={query.isFetching}
      state={state}
      onChange={setState}
      showPagination={query.data.total > catalogPageSize}
      {...rowFilters}
    />
  );
}

export function PracticeTopicAccordion({
  actor,
  filters,
  group,
  initiallyOpen,
  rowFilters,
}: TopicPanelProps & {
  group: NonNullable<CatalogPage["topicGroupStats"]>[number];
  initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const label = group.label ?? "Other questions";

  return (
    <details
      className="practice-topic-accordion"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <ChevronRight className="practice-topic-chevron" size={16} aria-hidden="true" />
        <span>{label}</span>
        {group.solved === undefined ? (
          <span className="practice-topic-progress">
            {group.total} {group.total === 1 ? "question" : "questions"}
          </span>
        ) : (
          <span className="practice-topic-progress">
            <span aria-label={`${group.solved} of ${group.total} solved`}>
              {group.solved}/{group.total}
            </span>
            <progress value={group.solved} max={group.total} aria-label={`${label} progress`} />
          </span>
        )}
      </summary>
      {open && (
        <TopicQuestions
          key={JSON.stringify(filters)}
          actor={actor}
          filters={{ ...filters, topicGroup: group.label }}
          rowFilters={rowFilters}
        />
      )}
    </details>
  );
}
