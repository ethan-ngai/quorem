/** @file PracticeQuestionTable.tsx @description Question rows and pagination shared by both practice layouts. @module practice */
import { useNavigate, Link } from "@tanstack/react-router";
import { useServerTable, type ListState } from "../../ui/useServerTable";
import { TablePagination, TableSortHeader } from "../../ui/TableControls";
import { TableRow, Table } from "../../ui/Table";
import { warmWorkspacePage } from "../editor/preloadWorkspace";
import { QuestionDifficulty, QuestionTopics } from "./QuestionRowMetadata";
import { QuestionIndicators } from "./QuestionIndicators";
import type { CatalogPage } from "./problemQueries";

const columns = [{ accessorKey: "title" }, { accessorKey: "difficulty" }];
export type PracticeTableState = ListState<"title" | "difficulty">;
export type PracticeRowFilters = {
  filterTopic: (topic: string) => void;
  filterDifficulty: (difficulty: string) => void;
};

export function PracticeQuestionTable({
  data,
  placeholder,
  fetching,
  state,
  onChange,
  filterTopic,
  filterDifficulty,
  showPagination = true,
}: PracticeRowFilters & {
  data: CatalogPage;
  placeholder: boolean;
  fetching: boolean;
  showPagination?: boolean;
  state: PracticeTableState;
  onChange: (state: PracticeTableState) => void;
}) {
  const navigate = useNavigate({ from: "/practice" });
  const table = useServerTable({
    data: data.items,
    columns,
    total: data.total,
    loading: fetching || placeholder,
    state,
    onChange,
  });
  const solvedIds = new Set(data.solvedIds);
  return (
    <>
      <Table
        label="Practice questions"
        heading={
          <tr>
            <TableSortHeader column={table.getColumn("title")!}>Question</TableSortHeader>
            <TableSortHeader column={table.getColumn("difficulty")!}>Difficulty</TableSortHeader>
            <th aria-label="Question details and actions" />
          </tr>
        }
      >
        {data.items.map((problem) => (
          <TableRow
            key={problem.id}
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
            <td>
              <Link to="/practice/$slug" params={{ slug: problem.slug }}>
                {problem.title}
              </Link>
              <QuestionTopics tags={problem.tags} onFilter={filterTopic} />
            </td>
            <td>
              <QuestionDifficulty difficulty={problem.difficulty} onFilter={filterDifficulty} />
            </td>
            <td className="practice-format">
              {(problem.isPrivate || solvedIds.has(problem.id)) && (
                <QuestionIndicators
                  privateQuestion={!!problem.isPrivate}
                  solved={solvedIds.has(problem.id)}
                />
              )}
            </td>
          </TableRow>
        ))}
      </Table>
      {showPagination && (
        <TablePagination table={table} snapshot={placeholder ? data : undefined} />
      )}
    </>
  );
}
