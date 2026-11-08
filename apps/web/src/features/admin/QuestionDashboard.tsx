import { useServerTable, type ListState } from "../../ui/useServerTable";
import { TablePagination, TableSortHeader } from "../../ui/TableControls";
import { PersistentNotice } from "../../ui/PersistentNotice";
import { Link } from "@tanstack/react-router";
import type { QuestionSearch } from "./questionSearch";
/** @file QuestionDashboard.tsx @description Question catalog and bulk authoring actions. @module admin */
import { CodeXml, FileCode2, FilePenLine, Globe, Layers } from "lucide-react";
import { CatalogFilters } from "../practice/CatalogFilters";
import { addFilter } from "../practice/catalogSearch";
import { QuestionIndicators } from "../practice/QuestionIndicators";
import { QuestionDifficulty, QuestionTopics } from "../practice/QuestionRowMetadata";
import { TableRow, Table } from "../../ui/Table";
import { SearchField } from "../../ui/SearchField";
import { useServerSearch } from "../../ui/useServerSearch";
import { SelectField } from "../../ui/SelectField";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Icon } from "../../ui/Icon";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { notifyBatchResult } from "../../ui/Notifications";
import type { QuestionDraftSummary } from "@quorem/contracts";
import { runQuestionBatches } from "./runQuestionBatches";
import { requireSudo } from "../auth/sudo";
import { BulkQuestionConfirmation } from "./BulkQuestionConfirmation";
import { LoadingScreen } from "../../ui/LoadingScreen";
import { userFacingErrorMessage } from "../../ui/errors";
import { mutateQuestionBatch, listPublications } from "./api";

type Publication = Awaited<ReturnType<typeof listPublications>>["items"][number];
type Row = QuestionDraftSummary | Publication;
const dashboardColumns = [
  { accessorKey: "title" },
  { accessorKey: "difficulty" },
  { accessorKey: "updatedAt", sortDescFirst: true },
];
type Action = "publish" | "delete";

export function QuestionDashboard({
  admin,
  search,
  facets,
  onSearch,
  drafts,
  publications,
  loading,
  refreshing,
  failed,
  snapshot,
  onRunning,
  busy,
  total,
  onOpen,
  onChanged,
}: {
  admin: boolean;
  search: QuestionSearch;
  facets?: { topics: string[]; companies: string[] };
  onSearch: (change: Partial<QuestionSearch>, replace?: boolean) => void;
  drafts: QuestionDraftSummary[];
  publications: Publication[];
  loading: boolean;
  refreshing: boolean;
  failed: boolean;
  snapshot?: Pick<ListState, "page" | "limit">;
  onRunning: (running: boolean) => void;
  busy: boolean;
  total?: number;
  onOpen: (row: Row) => void;
  onChanged: () => Promise<unknown>;
}) {
  const tab = search.section;
  const query = useServerSearch(
    search.q ?? "",
    (q) => onSearch({ q: q || undefined }, true),
    search,
  );
  const source = search.source ?? "all";
  const readiness = search.readiness ?? "all";
  const selectionScope = JSON.stringify(search);
  const [selection, setSelection] = useState<{ scope: string; ids: Set<string> }>();
  const selected =
    !snapshot && selection?.scope === selectionScope ? selection.ids : new Set<string>();
  const [confirmation, setConfirmation] = useState<{ action: Action; rows: Row[] }>();
  const action = confirmation?.action;
  const confirmed = confirmation?.rows ?? [];
  const [visibility, setVisibility] = useState<"private" | "global">("private");
  const cancellation = useRef(false);
  const [stopping, setStopping] = useState(false);
  const [operationError, setOperationError] = useState<string>();
  const [running, setRunning] = useState(false);
  const [errors, setErrors] = useState<{ id: string; title: string; message: string }[]>([]);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const notification = useId();
  const rows: Row[] = tab === "drafts" ? drafts : publications;
  const chosen = rows.filter((row) => selected.has(row.id));
  const allVisible = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const disabled = busy || running;

  const page = search.page ?? 1;
  const limit = search.limit ?? 50;
  const table = useServerTable({
    data: rows,
    columns: dashboardColumns,
    total,
    loading: loading || refreshing || !!snapshot || failed,
    state: {
      page,
      limit,
      sort: search.sort ?? (tab === "drafts" ? "updatedAt" : "title"),
      order: search.order ?? (tab === "drafts" ? "desc" : "asc"),
    },
    onChange: (next) =>
      onSearch({
        page: next.page === 1 ? undefined : next.page,
        limit: next.limit,
        sort: next.sort,
        order: next.order,
      }),
  });
  function toggle(ids: string[], checked: boolean) {
    setSelection((current) => {
      const next = new Set(current?.scope === selectionScope ? current.ids : undefined);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return { scope: selectionScope, ids: next };
    });
  }

  async function apply() {
    if (!action || disabled || !confirmed.length) return;
    cancellation.current = false;
    setStopping(false);
    setOperationError(undefined);
    setRunning(true);
    onRunning(true);
    setErrors([]);
    setErrorsOpen(false);
    toast.loading(
      `${action === "publish" ? "Publishing" : "Deleting"} ${confirmed.length} questions…`,
      { id: notification },
    );
    const failures: typeof errors = [];
    const succeeded: string[] = [];
    let stoppedByError = false;
    try {
      await runQuestionBatches({
        rows: confirmed,
        cancelled: () => cancellation.current,
        verify: requireSudo,
        onProgress: (completed, verifying) =>
          toast.loading(
            cancellation.current
              ? "Stopping after the current request…"
              : verifying
                ? "Confirm your identity to continue…"
                : `${action === "publish" ? "Publishing" : "Deleting"} ${completed} of ${confirmed.length}…`,
            { id: notification },
          ),
        send: async (rows) => {
          const draftRows = rows.filter((row): row is QuestionDraftSummary => "revision" in row);
          return mutateQuestionBatch(
            action === "publish"
              ? {
                  action: "publish",
                  items: draftRows.map((row) => ({
                    id: row.id,
                    revision: row.revision,
                    visibility: row.editVersionId ? "global" : visibility,
                  })),
                }
              : draftRows.length
                ? {
                    action: "delete-drafts",
                    items: draftRows.map(({ id, revision }) => ({ id, revision })),
                  }
                : {
                    action: "delete-publications",
                    items: rows
                      .filter((row): row is Publication => !("revision" in row))
                      .map(({ id, current }) => ({ id, current })),
                  },
          );
        },
        onResults: (items) => {
          for (const item of items) {
            if (item.status === "succeeded") succeeded.push(item.id);
            else
              failures.push({
                id: item.id,
                title: confirmed.find((row) => row.id === item.id)?.title || "Untitled question",
                message: item.message || "The change could not be completed.",
              });
          }
          setErrors([...failures]);
        },
      });
    } catch (cause) {
      stoppedByError = true;
      const message = userFacingErrorMessage(
        cause,
        "The request failed. Remaining questions were not sent. Refresh before retrying.",
      );
      setOperationError(message);
      toast.error(message, { id: notification });
    } finally {
      toggle(succeeded, false);
      setErrors(failures);
      if (!cancellation.current && !stoppedByError)
        notifyBatchResult({
          id: notification,
          verb: action === "publish" ? "Published" : "Deleted",
          noun: "question",
          succeeded: succeeded.length,
          failed: failures.length,
          onDetails: () => setErrorsOpen(true),
        });
      if (cancellation.current)
        toast.info("Stopped. Unfinished questions remain selected.", {
          id: notification,
          description: succeeded.length ? `${succeeded.length} questions completed.` : undefined,
        });
      setConfirmation(undefined);
      setRunning(false);
      onRunning(false);
      await onChanged().catch(() => {
        setOperationError("Could not refresh questions. Refresh before retrying.");
      });
    }
  }

  return (
    <section className="admin-dashboard" aria-label="Question catalog">
      <div className="admin-toolbar">
        <div className="admin-toolbar" role="group" aria-label="Question views">
          <button
            type="button"
            className="button button-secondary"
            aria-pressed={tab === "drafts"}
            disabled={disabled}
            onClick={() => {
              onSearch({ sort: undefined, order: undefined, section: "drafts" });
            }}
          >
            <Icon name="problem" />
            Drafts
          </button>
          <button
            type="button"
            className="button button-secondary"
            aria-pressed={tab === "publications"}
            disabled={disabled}
            onClick={() => {
              onSearch({ sort: undefined, order: undefined, section: "publications" });
            }}
          >
            <Globe size={18} strokeWidth={1.5} aria-hidden="true" />
            Publications
          </button>
        </div>
        <SearchField
          className="admin-question-search"
          aria-label="Search questions"
          placeholder="Search questions"
          value={query.text}
          maxLength={120}
          onChange={(event) => query.change(event.target.value)}
          refreshing={refreshing}
          disabled={disabled}
        />
      </div>
      <fieldset
        className="practice-filters admin-catalog-filters"
        aria-label="Question filters"
        disabled={disabled}
      >
        <SegmentedControl
          iconOnly
          label="Question source"
          value={source}
          onChange={(value) => onSearch({ source: value === "all" ? undefined : value })}
          disabled={disabled}
          options={[
            {
              value: "all",
              label: "All sources",
              icon: <Layers size={16} aria-hidden="true" />,
            },
            {
              value: "leetcode",
              label: "LeetCode",
              icon: <CodeXml size={16} aria-hidden="true" />,
            },
            {
              value: "other",
              label: "No LeetCode ID",
              icon: <FileCode2 size={16} aria-hidden="true" />,
            },
          ]}
        />
        <CatalogFilters
          search={search}
          update={onSearch}
          topics={facets?.topics ?? []}
          companies={facets?.companies ?? []}
        />
        {tab === "drafts" && (
          <SelectField
            label="Readiness"
            value={readiness}
            onChange={(value) =>
              onSearch({
                readiness: value === "ready" || value === "needs-fixes" ? value : undefined,
              })
            }
            disabled={disabled}
            options={[
              { value: "all", label: "All drafts" },
              { value: "ready", label: "Ready" },
              { value: "needs-fixes", label: "Needs fixes" },
            ]}
          />
        )}
      </fieldset>
      <div
        className="admin-bulk-disclosure"
        data-open={chosen.length > 0 || errors.length > 0 || !!operationError}
        aria-hidden={chosen.length === 0 && errors.length === 0 && !operationError}
        inert={chosen.length === 0 && errors.length === 0 && !operationError}
      >
        <div>
          <div className="admin-toolbar admin-bulk-bar">
            <div className="admin-toolbar admin-bulk-selection">
              {chosen.length > 0 && <span>{chosen.length} selected</span>}
              <PersistentNotice
                label="Bulk action needs attention"
                message={[
                  ...(operationError ? [operationError] : []),
                  ...errors.map((error) => `${error.title}: ${error.message}`),
                ]}
                open={errorsOpen}
                onOpenChange={setErrorsOpen}
              />
            </div>
            {chosen.length > 0 && (
              <div className="admin-toolbar">
                {tab === "drafts" && (
                  <button
                    className="button button-primary"
                    disabled={disabled || !chosen.length}
                    onClick={() => {
                      setVisibility("private");
                      setConfirmation({ action: "publish", rows: chosen });
                    }}
                  >
                    <Icon name="submit" />
                    Publish selected
                  </button>
                )}
                <button
                  className="button button-secondary admin-delete-action"
                  disabled={disabled || !chosen.length}
                  onClick={() => setConfirmation({ action: "delete", rows: chosen })}
                >
                  <Icon name="trash" />
                  Delete selected
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {loading ? (
        <LoadingScreen inline label="Loading questions…" />
      ) : failed ? (
        <p role="alert">Questions could not be loaded. Refresh to try again.</p>
      ) : (
        <div className="admin-table-scroll" aria-busy={refreshing}>
          <Table
            className="admin-question-table"
            label={tab === "drafts" ? "Draft questions" : "Question publications"}
            heading={
              <tr>
                <th scope="col">
                  <input
                    type="checkbox"
                    aria-label="Select all visible questions"
                    checked={allVisible}
                    ref={(input) => {
                      if (input)
                        input.indeterminate =
                          !allVisible && rows.some((row) => selected.has(row.id));
                    }}
                    disabled={disabled || !!snapshot || !rows.length}
                    onChange={(event) =>
                      toggle(
                        rows.map((row) => row.id),
                        event.target.checked,
                      )
                    }
                  />
                </th>
                <TableSortHeader column={table.getColumn("title")!} disabled={disabled}>
                  Question
                </TableSortHeader>
                <TableSortHeader column={table.getColumn("difficulty")!} disabled={disabled}>
                  Difficulty
                </TableSortHeader>
                {tab === "drafts" ? (
                  <TableSortHeader column={table.getColumn("updatedAt")!} disabled={disabled}>
                    Last edited
                  </TableSortHeader>
                ) : (
                  <th aria-label="Visibility" />
                )}
              </tr>
            }
          >
            {rows.map((row) => (
              <TableRow
                key={row.id}
                data-selected={selected.has(row.id)}
                onOpen={disabled ? undefined : () => onOpen(row)}
              >
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.title || "untitled question"}`}
                    checked={selected.has(row.id)}
                    disabled={disabled || !!snapshot}
                    onChange={(event) => toggle([row.id], event.target.checked)}
                  />
                </td>
                <th scope="row">
                  <div className="admin-question-heading">
                    {disabled ? (
                      <span className="table-title">{row.title || "Untitled question"}</span>
                    ) : (
                      <Link
                        to="/questions"
                        search={{
                          ...search,
                          draft: "revision" in row ? row.id : undefined,
                          publication: "revision" in row ? undefined : row.id,
                        }}
                        className="table-title"
                      >
                        {row.title || "Untitled question"}
                      </Link>
                    )}
                    {"revision" in row ? (
                      <>
                        {row.editVersionId && (
                          <span className="admin-question-status">
                            <FilePenLine size={14} aria-hidden="true" />
                            Update draft
                          </span>
                        )}
                        {row.ready === false && (
                          <span className="admin-question-status">Needs fixes</span>
                        )}
                      </>
                    ) : (
                      !row.current && (
                        <span className="admin-question-status">
                          <Icon name="eye-off" width={14} height={14} />
                          Unpublished
                        </span>
                      )
                    )}
                    {row.isOdyssey && <QuestionIndicators privateQuestion={false} odyssey />}
                  </div>
                  <QuestionTopics
                    tags={row.tags}
                    disabled={disabled}
                    onFilter={(topic) => onSearch({ topic: addFilter(search.topic, topic) })}
                  />
                </th>
                <td>
                  <QuestionDifficulty
                    difficulty={row.difficulty}
                    disabled={disabled}
                    onFilter={(difficulty) =>
                      onSearch({ difficulty: addFilter(search.difficulty, difficulty) })
                    }
                  />
                </td>
                {"updatedAt" in row ? (
                  <td>
                    <time dateTime={row.updatedAt}>
                      {new Date(row.updatedAt).toLocaleDateString()}
                    </time>
                  </td>
                ) : (
                  <td className="practice-format">
                    {row.isPrivate && <QuestionIndicators privateQuestion odyssey={false} />}
                  </td>
                )}
              </TableRow>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4}>No matching questions.</td>
              </tr>
            )}
          </Table>
        </div>
      )}
      {!loading && !failed && (
        <TablePagination table={table} disabled={disabled} snapshot={snapshot} />
      )}
      <BulkQuestionConfirmation
        action={action}
        questions={confirmed}
        scope={tab}
        admin={admin}
        visibility={visibility}
        onVisibilityChange={setVisibility}
        running={running}
        stopping={stopping}
        onCancel={() => {
          cancellation.current = true;
          setStopping(true);
          toast.loading("Stopping after the current request…", { id: notification });
        }}
        onClose={() => setConfirmation(undefined)}
        onConfirm={() => void apply()}
      />
    </section>
  );
}
