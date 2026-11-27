/** @file PracticeQuestionTable.tsx @description Question rows and pagination shared by both practice layouts. @module practice */
import { createContext, useContext, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { ChartNoAxesColumnIncreasing, Clock3, Gauge, type LucideIcon } from "lucide-react";
import { useServerTable, type ListState } from "../../ui/useServerTable";
import { TablePagination, TableSortHeader } from "../../ui/TableControls";
import { TableRow, Table } from "../../ui/Table";
import { warmWorkspacePage } from "../editor/preloadWorkspace";
import { QuestionDifficulty, QuestionTopics } from "./QuestionRowMetadata";
import { QuestionIndicators } from "./QuestionIndicators";
import type { CatalogPage } from "./problemQueries";
import "./practice-table.css";

const sortableColumns = [{ accessorKey: "title" }, { accessorKey: "difficulty" }];
const columns = [...sortableColumns, { id: "company-recent" }];
const CompanyColumns = createContext(false);
const recencyLabels = {
  "30d": "30d",
  "3m": "3mo",
  "6m": "6mo",
  older: "6mo+",
  all: "All time",
};

/** Round the displayed score while preserving blank cells for missing observations. */
function roundedFrequency(score?: number) {
  return score == null ? null : Math.round(score);
}

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
  const showCompanyEvidence = !!page.data.companyEvidence;
  return (
    <CompanyColumns value={showCompanyEvidence}>
      <Table
        className={groupBodies ? "practice-grouped-table" : undefined}
        rowGroups={!!groupBodies}
        label="Practice questions"
        heading={
          <tr>
            <TableSortHeader column={table.getColumn("title")!}>Question</TableSortHeader>
            <TableSortHeader column={table.getColumn("difficulty")!}>
              <PracticeHeading icon={Gauge} label="Difficulty" />
            </TableSortHeader>
            {showCompanyEvidence && (
              <>
                <TableSortHeader
                  column={table.getColumn("company-recent")!}
                  className="practice-recency"
                  onSort={() => {
                    if (page.state.sort !== "company-recent")
                      page.onChange({
                        ...page.state,
                        page: 1,
                        sort: "company-recent",
                        order: "asc",
                      });
                  }}
                >
                  <PracticeHeading icon={Clock3} label="Recency" />
                </TableSortHeader>
                <th scope="col" className="practice-frequency" aria-label="Frequency">
                  <PracticeHeading
                    icon={ChartNoAxesColumnIncreasing}
                    label="Frequency"
                    hint="Frequency source score, 0–100"
                  />
                </th>
              </>
            )}
            <th scope="col" aria-label="Status" className="practice-status" />
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
    </CompanyColumns>
  );
}

/** Give icon-only headings a hover label and accessible name. */
function PracticeHeading({
  icon: Icon,
  label,
  hint = label,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
}) {
  return (
    <span className="practice-table-heading" title={hint}>
      <Icon size={16} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Span all visible columns in a practice row group. */
export function usePracticeColumnCount() {
  return sortableColumns.length + 1 + (useContext(CompanyColumns) ? 2 : 0);
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
  const showCompanyEvidence = useContext(CompanyColumns);
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
            <Link to="/practice/$slug" params={{ slug: problem.slug }}>
              {problem.title}
            </Link>
            <QuestionTopics tags={problem.tags} onFilter={filterTopic} />
          </PracticeQuestionCell>
          <PracticeQuestionCell>
            <QuestionDifficulty difficulty={problem.difficulty} onFilter={filterDifficulty} />
          </PracticeQuestionCell>
          {showCompanyEvidence && (
            <>
              <PracticeQuestionCell className="practice-recency">
                {observations?.[problem.id] && recencyLabels[observations[problem.id].window]}
              </PracticeQuestionCell>
              <PracticeQuestionCell className="practice-frequency">
                {roundedFrequency(observations?.[problem.id]?.frequency)}
              </PracticeQuestionCell>
            </>
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
