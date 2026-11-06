import { useServerTable } from "../../ui/useServerTable";
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
import { SelectField } from "../../ui/SelectField";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Icon } from "../../ui/Icon";
import { useId, useState } from "react";
import { toast } from "sonner";
import { notifyBatchResult } from "../../ui/Notifications";
import type { QuestionDraftSummary } from "@quorem/contracts";
import { SessionDialog } from "../../ui/SessionDialog";
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
  draftLoading,
  publicationLoading,
  draftFailed,
  publicationFailed,
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
  draftLoading: boolean;
  publicationLoading: boolean;
  draftFailed: boolean;
  publicationFailed: boolean;
  onRunning: (running: boolean) => void;
  busy: boolean;
  total?: number;
  onOpen: (row: Row) => void;
  onChanged: () => Promise<unknown>;
}) {
  const tab = search.section;
  const query = search.q ?? "";
  const source = search.source ?? "all";
  const readiness = search.readiness ?? "all";
  const selectionScope = JSON.stringify(search);
  const [selection, setSelection] = useState<{ scope: string; ids: Set<string> }>();
  const selected = selection?.scope === selectionScope ? selection.ids : new Set<string>();
  const [confirmation, setConfirmation] = useState<{ action: Action; rows: Row[] }>();
  const action = confirmation?.action;
  const confirmed = confirmation?.rows ?? [];
  const [visibility, setVisibility] = useState<"private" | "global">("private");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [errors, setErrors] = useState<{ id: string; title: string; message: string }[]>([]);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const notification = useId();
  const rows: Row[] = tab === "drafts" ? drafts : publications;
  const chosen = rows.filter((row) => selected.has(row.id));
  const allVisible = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const disabled = busy || running;
  const loading = tab === "drafts" ? draftLoading : publicationLoading;
  const failed = tab === "drafts" ? draftFailed : publicationFailed;

  const page = search.page ?? 1;
  const limit = search.limit ?? 50;
  const table = useServerTable({
    data: rows,
    columns: dashboardColumns,
    total,
    loading: loading || failed,
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
    try {
      for (let offset = 0; offset < confirmed.length; offset += 16) {
        const rows = confirmed.slice(offset, offset + 16);
        setProgress(`Completed ${offset} of ${confirmed.length}…`);
        try {
          const draftRows = rows.filter((row): row is QuestionDraftSummary => "revision" in row);
          const result = await mutateQuestionBatch(
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
          for (const item of result.items) {
            if (item.status === "succeeded") succeeded.push(item.id);
            else
              failures.push({
                id: item.id,
                title: rows.find((row) => row.id === item.id)?.title || "Untitled question",
                message: item.message || "The change could not be completed.",
              });
          }
        } catch (cause) {
          for (const row of rows)
            failures.push({
              id: row.id,
              title: row.title || "Untitled question",
              message: userFacingErrorMessage(cause, "The change could not be completed."),
            });
        }
      }
      toggle(succeeded, false);
      setErrors(failures);
      setProgress("");
      notifyBatchResult({
        id: notification,
        verb: action === "publish" ? "Published" : "Deleted",
        noun: "question",
        succeeded: succeeded.length,
        failed: failures.length,
        onDetails: () => setErrorsOpen(true),
      });
      setConfirmation(undefined);
      await onChanged();
    } finally {
      setRunning(false);
      onRunning(false);
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
          value={query}
          maxLength={120}
          onChange={(event) => onSearch({ q: event.target.value || undefined }, true)}
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
        data-open={chosen.length > 0 || errors.length > 0}
        aria-hidden={chosen.length === 0 && errors.length === 0}
        inert={chosen.length === 0 && errors.length === 0}
      >
        <div>
          <div className="admin-toolbar admin-bulk-bar">
            {chosen.length > 0 && <span>{chosen.length} selected</span>}
            <PersistentNotice
              label="Some bulk actions failed"
              message={errors.map((error) => `${error.title}: ${error.message}`)}
              open={errorsOpen}
              onOpenChange={setErrorsOpen}
            />
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
        <div className="admin-table-scroll">
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
                    disabled={disabled || !rows.length}
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
                    disabled={disabled}
                    onChange={(event) => toggle([row.id], event.target.checked)}
                  />
                </td>
                <th scope="row">
                  <div className="admin-question-heading">
                    {disabled ? (
                      <span className="table-title">
                        {row.title || "Untitled question"}
                      </span>
                    ) : (
                      <Link
                        to="/admin/questions"
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
      {!loading && !failed && <TablePagination table={table} disabled={disabled} />}
      <SessionDialog
        open={!!action}
        pending={running}
        onOpenChange={(open) => {
          if (!open && !running) setConfirmation(undefined);
        }}
        title={
          action === "publish"
            ? `Publish ${confirmed.length} drafts?`
            : `Delete ${confirmed.length} ${tab === "drafts" ? "drafts" : "versions"}?`
        }
        description={
          action === "publish"
            ? "Each draft is validated before publishing. Update drafts apply to their existing global publication."
            : tab === "drafts"
              ? "Selected drafts and their imported content will be removed."
              : "Only the listed versions will be deleted. Deleting a current version unpublishes its question. Older versions remain available in the editor."
        }
      >
        <ul className="admin-bulk-selection" aria-label="Selected questions">
          {confirmed.map((row) => (
            <li key={row.id}>
              {row.title || "Untitled question"}
              {"version" in row ? ` · Version ${row.version}` : ""}
            </li>
          ))}
        </ul>
        {action === "publish" &&
          admin &&
          confirmed.some((row) => "revision" in row && !row.editVersionId) && (
            <label className="admin-bulk-visibility">
              New publication visibility
              <select
                value={visibility}
                disabled={running}
                onChange={(event) =>
                  setVisibility(event.target.value === "global" ? "global" : "private")
                }
              >
                <option value="private">Private library</option>
                <option value="global">Global catalog</option>
              </select>
            </label>
          )}
        {running && <p role="status">{progress}</p>}
        <footer className="competitive-dialog-actions">
          <button
            className="button button-secondary"
            disabled={running}
            onClick={() => setConfirmation(undefined)}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={running || !confirmed.length}
            onClick={() => void apply()}
          >
            {action === "publish" ? "Publish drafts" : "Delete selected"}
          </button>
        </footer>
      </SessionDialog>
    </section>
  );
}
