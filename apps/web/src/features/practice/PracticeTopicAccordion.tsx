/** @file PracticeTopicAccordion.tsx @description Topic progress and on-demand practice questions. @module practice */
import { motion } from "@quorem/ui/tokens";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TableBody } from "../../ui/Table";
import { TablePagination } from "../../ui/TableControls";
import { ChevronRight } from "lucide-react";
import { LoadingButton } from "../../ui/LoadingButton";
import { LoadingScreen } from "../../ui/LoadingScreen";
import {
  PracticeQuestionSpan,
  usePracticeColumnCount,
  PracticeQuestionRows,
  usePracticeTable,
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

function TopicQuestions({
  actor,
  filters,
  rowFilters,
  closing,
}: TopicPanelProps & { closing: boolean }) {
  const client = useQueryClient();
  const [state, setState] = useState<PracticeTableState>({
    page: 1,
    limit: catalogPageSize,
    sort: filters.sort === "recommended" ? "title" : (filters.sort ?? "title"),
    order: filters.order ?? "asc",
  });
  const query = useQuery(
    catalogQueryOptions(client, actor, {
      ...filters,
      ...state,
      sort: state.sort === "title" ? undefined : state.sort,
      order: state.order === "asc" ? undefined : state.order,
    }),
  );
  if (query.isPending)
    return (
      <tr className="practice-topic-message" inert={closing}>
        <PracticeQuestionSpan>
          <LoadingScreen inline label="Loading questions…" />
        </PracticeQuestionSpan>
      </tr>
    );
  if (query.isError)
    return (
      <tr className="practice-topic-message" inert={closing}>
        <PracticeQuestionSpan>
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
        </PracticeQuestionSpan>
      </tr>
    );
  return (
    <>
      <PracticeQuestionRows data={query.data} inert={closing} {...rowFilters} />
      {query.data.total > catalogPageSize && (
        <TopicPagination
          data={query.data}
          closing={closing}
          placeholder={query.isPlaceholderData}
          fetching={query.isFetching}
          state={state}
          onChange={setState}
        />
      )}
    </>
  );
}

function TopicPagination(props: Parameters<typeof usePracticeTable>[0] & { closing: boolean }) {
  const table = usePracticeTable(props);
  return (
    <tr className="practice-topic-message" inert={props.closing}>
      <PracticeQuestionSpan>
        <TablePagination table={table} snapshot={props.placeholder ? props.data : undefined} />
      </PracticeQuestionSpan>
    </tr>
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
  const [closing, setClosing] = useState(false);
  const [animate, setAnimate] = useState(false);
  // Keep the exit in the table flow so following headings rise with the shrinking rows.
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => setClosing(false), Number.parseFloat(motion.standard));
    return () => window.clearTimeout(timer);
  }, [closing]);
  const label = group.label ?? "Other";
  const columnCount = usePracticeColumnCount();

  return (
    <TableBody animateChanges={false}>
      <tr
        className="practice-topic-heading"
        data-exiting={closing || undefined}
        data-animate={animate || undefined}
      >
        <th scope="rowgroup" colSpan={columnCount}>
          <button
            type="button"
            aria-expanded={open}
            onClick={(event) => {
              const animate =
                event.detail > 0 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
              setAnimate(animate);
              setClosing(open && animate);
              setOpen(!open);
            }}
          >
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
          </button>
        </th>
      </tr>
      {(open || closing) && (
        <TopicQuestions
          key={JSON.stringify(filters)}
          closing={closing}
          actor={actor}
          filters={{ ...filters, topicGroup: group.label }}
          rowFilters={rowFilters}
        />
      )}
    </TableBody>
  );
}
