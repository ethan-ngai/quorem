/** @file PracticeQuestionTable.tsx @description Question rows and pagination shared by both practice layouts. @module practice */
import { createContext, useContext, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useServerTable, type ListState } from "../../ui/useServerTable";
import { TablePagination, TableSortHeader } from "../../ui/TableControls";
import { TableRow, Table } from "../../ui/Table";
import { warmWorkspacePage } from "../editor/preloadWorkspace";
import { QuestionDifficulty, QuestionTopics } from "./QuestionRowMetadata";
import { CompanyRecencyIcon } from "./CompanyRecency";
import { QuestionIndicators } from "./QuestionIndicators";
import type { CatalogPage } from "./problemQueries";

const columns = [{ accessorKey: "title" }, { accessorKey: "difficulty" }];
const FrequencyColumn = createContext(false);

export type PracticeTableState = ListState<"title" | "difficulty" | "company-recent">;
export type PracticeRowFilters = {
  filterTopic: (topic: string) => void;
  filterDifficulty: (difficulty: string) => void;
};

type TablePageProps = {
  data: CatalogPage;
  placeholder: boolean;
  fetching: boolean;
  state: PracticeTableState;
  onChange: (state: PracticeTableState) => void;
};

export function usePracticeTable({ data, placeholder, fetching, state, onChange }: TablePageProps) {
  return useServerTable({
    data: data.items,
    columns,
    total: data.total,
    loading: fetching || placeholder,
    state,
    onChange,
  });
}

export function PracticeQuestionTable({
  groupBodies,
  filterTopic,
  filterDifficulty,
  ...page
}: PracticeRowFilters & TablePageProps & { groupBodies?: ReactNode }) {
  const table = usePracticeTable(page);
  const showFrequency = !!page.data.companyEvidence;
  return (
    <FrequencyColumn value={showFrequency}>
      <Table
        className={groupBodies ? "practice-grouped-table" : undefined}
        rowGroups={!!groupBodies}
        label="Practice questions"
        heading={
          <tr>
            <TableSortHeader column={table.getColumn("title")!}>Question</TableSortHeader>
            <TableSortHeader column={table.getColumn("difficulty")!}>Difficulty</TableSortHeader>
            {showFrequency && (
              <th scope="col" className="practice-frequency" title="Source frequency score (0–100)">
                Frequency
              </th>
            )}
            <th scope="col">Status</th>
          </tr>
        }
      >
        {groupBodies ?? (
          <PracticeQuestionRows
            data={page.data}
            filterTopic={filterTopic}
            filterDifficulty={filterDifficulty}
          />
        )}
      </Table>
      {!groupBodies && (
        <TablePagination table={table} snapshot={page.placeholder ? page.data : undefined} />
      )}
    </FrequencyColumn>
  );
}

/** Span all visible columns in a practice row group. */
export function usePracticeColumnCount() {
  return columns.length + 1 + Number(useContext(FrequencyColumn));
}

/** Keep pagination and group status aligned with the current table. */
export function PracticeQuestionSpan(props: ComponentPropsWithoutRef<"td">) {
  return <PracticeQuestionCell {...props} colSpan={usePracticeColumnCount()} />;
}

export function PracticeQuestionCell({ children, ...props }: ComponentPropsWithoutRef<"td">) {
  return (
    <td {...props}>
      <div className="practice-cell-reveal">
        <div className="practice-cell-clip">
          <div className="practice-cell-content">{children}</div>
        </div>
      </div>
    </td>
  );
}

export function PracticeQuestionRows({
  data,
  filterTopic,
  filterDifficulty,
  inert,
}: PracticeRowFilters & { data: CatalogPage; inert?: boolean }) {
  const navigate = useNavigate({ from: "/practice" });
  const solvedIds = new Set(data.solvedIds);
  const observations = data.companyEvidence?.observations;
  const showFrequency = useContext(FrequencyColumn);
  return (
    <>
      {data.items.map((problem) => (
        <TableRow
          key={problem.id}
          inert={inert}
          onPointerEnter={warmWorkspacePage}
          onFocusCapture={warmWorkspacePage}
          onOpen={(event) => {
            const href = `/practice/${problem.slug}`;
            if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
            else
              void navigate({
                to: "/practice/$slug",
                params: { slug: problem.slug },
              });
          }}
        >
          <PracticeQuestionCell>
            <span className="practice-question-title">
              <Link to="/practice/$slug" params={{ slug: problem.slug }}>
                {problem.title}
              </Link>
              <CompanyRecencyIcon window={observations?.[problem.id]?.window} />
            </span>
            <QuestionTopics tags={problem.tags} onFilter={filterTopic} />
          </PracticeQuestionCell>
          <PracticeQuestionCell>
            <QuestionDifficulty difficulty={problem.difficulty} onFilter={filterDifficulty} />
          </PracticeQuestionCell>
          {showFrequency && (
            <PracticeQuestionCell className="practice-frequency">
              {observations?.[problem.id]?.frequency ?? (
                <span className="practice-frequency-missing">
                  <span className="sr-only">Unavailable</span>
                  <span aria-hidden="true">—</span>
                </span>
              )}
            </PracticeQuestionCell>
          )}
          <PracticeQuestionCell className="practice-format">
            {(problem.isPrivate || solvedIds.has(problem.id)) && (
              <QuestionIndicators
                privateQuestion={!!problem.isPrivate}
                solved={solvedIds.has(problem.id)}
              />
            )}
          </PracticeQuestionCell>
        </TableRow>
      ))}
    </>
  );
}
