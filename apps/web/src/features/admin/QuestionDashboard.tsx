import type { QuestionSearch } from "./questionSearch";
/** @file QuestionDashboard.tsx @description Question catalog and bulk authoring actions. @module admin */
import { FilePenLine, Globe, Search } from "lucide-react";
import { CatalogFilters } from "../practice/CatalogFilters";
import { addFilter } from "../practice/catalogSearch";
import { QuestionIndicators } from "../practice/QuestionIndicators";
import { QuestionDifficulty, QuestionTopics } from "../practice/QuestionRowMetadata";
import { CatalogTable } from "../practice/CatalogLayout";
import { SelectField } from "../../ui/SelectField";
import { Icon } from "../../ui/Icon";
import { useState } from "react";
import type { QuestionDraftSummary } from "@quorem/contracts";
import { SessionDialog } from "../../ui/SessionDialog";
import { LoadingScreen } from "../../ui/LoadingScreen";
import { UserFacingError, userFacingErrorMessage } from "../../ui/errors";
import {
  createDraft,
  deleteDraft,
  deleteQuestionPublication,
  fetchDeletionImpact,
  listPublications,
  publishDraft,
} from "./api";

type Publication = Awaited<ReturnType<typeof listPublications>>["items"][number];
type Row = QuestionDraftSummary | Publication;
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
  loadMore,
  loadingMore,
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
  loadMore?: () => void;
  loadingMore: boolean;
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
  const rows: Row[] = tab === "drafts" ? drafts : publications;
  const showVisibility = tab === "publications" && admin;
  const chosen = rows.filter((row) => selected.has(row.id));
  const allVisible = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const disabled = busy || running;
  const loading = tab === "drafts" ? draftLoading : publicationLoading;
  const failed = tab === "drafts" ? draftFailed : publicationFailed;

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
    const failures: typeof errors = [];
    const succeeded: string[] = [];
    try {
      // Serialize mutations so drafts sharing a slug follow the table order.
      for (const [index, row] of confirmed.entries()) {
        setProgress(`Working on ${index + 1} of ${confirmed.length}…`);
        try {
          if ("revision" in row) {
            if (action === "publish")
              await publishDraft(row, row.editVersionId ? "global" : visibility);
            else await deleteDraft(row);
          } else {
            const draft = await createDraft({ problemVersionId: row.id, edit: true });
            const impact = await fetchDeletionImpact(draft.id);
            if (impact.current !== row.current)
              throw new UserFacingError(
                "The current version changed. Refresh and review this selection.",
              );
            await deleteQuestionPublication(draft, row.current ? null : undefined);
          }
          succeeded.push(row.id);
        } catch (cause) {
          failures.push({
            id: row.id,
            title: row.title || "Untitled question",
            message: userFacingErrorMessage(cause, "The change could not be completed."),
          });
        }
      }
      toggle(succeeded, false);
      setErrors(failures);
      setProgress(
        `${succeeded.length} ${action === "publish" ? "published" : "deleted"} · ${failures.length} failed`,
      );
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
              onSearch({ section: "drafts" });
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
              onSearch({ section: "publications" });
            }}
          >
            <Globe size={18} strokeWidth={1.5} aria-hidden="true" />
            Publications
          </button>
        </div>
        <div className="admin-question-search">
          <Search size={16} strokeWidth={1.5} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search questions"
            placeholder="Search questions"
            value={query}
            maxLength={120}
            onChange={(event) => onSearch({ q: event.target.value || undefined }, true)}
            disabled={disabled}
          />
        </div>
      </div>
      <fieldset
        className="practice-filters admin-catalog-filters"
        aria-label="Question filters"
        disabled={disabled}
      >
        <SelectField
          label="Source"
          value={source}
          onChange={(value) =>
            onSearch({ source: value === "leetcode" || value === "other" ? value : undefined })
          }
          disabled={disabled}
          options={[
            { value: "all", label: "All sources" },
            { value: "leetcode", label: "LeetCode" },
            { value: "other", label: "No LeetCode ID" },
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
      <div className="admin-toolbar admin-bulk-bar">
        <span>{chosen.length} selected</span>
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
      </div>
      <p role="status">{progress}</p>
      {!!errors.length && (
        <ul aria-label="Bulk action errors" className="admin-bulk-errors">
          {errors.map((error) => (
            <li key={error.id}>
              <strong>{error.title}</strong> · {error.message}
            </li>
          ))}
        </ul>
      )}
      {loading ? (
        <LoadingScreen inline label="Loading questions…" />
      ) : failed ? (
        <p role="alert">Questions could not be loaded. Refresh to try again.</p>
      ) : (
        <div className="admin-table-scroll">
          <CatalogTable
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
                <th scope="col">Question</th>
                <th scope="col">Difficulty</th>
                {tab === "drafts" && <th scope="col">Last edited</th>}
                {showVisibility && <th scope="col">Visibility</th>}
              </tr>
            }
          >
            {rows.map((row) => (
              <tr key={row.id} data-selected={selected.has(row.id)}>
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
                  <button className="quiet-button" disabled={disabled} onClick={() => onOpen(row)}>
                    {row.title || "Untitled question"}
                  </button>
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
                {"updatedAt" in row && (
                  <td>
                    <time dateTime={row.updatedAt}>
                      {new Date(row.updatedAt).toLocaleDateString()}
                    </time>
                  </td>
                )}
                {showVisibility && "isPrivate" in row && (
                  <td>
                    <span className="admin-question-status">
                      {row.isPrivate ? (
                        <Icon name="lock" width={14} height={14} />
                      ) : (
                        <Globe size={14} aria-hidden="true" />
                      )}
                      {row.isPrivate ? "Private" : "Global"}
                    </span>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={tab === "drafts" || showVisibility ? 4 : 3}>No matching questions.</td>
              </tr>
            )}
          </CatalogTable>
        </div>
      )}
      {tab === "drafts" && loadMore && (
        <button
          className="button button-secondary"
          disabled={disabled || loadingMore}
          onClick={loadMore}
        >
          {loadingMore ? "Loading…" : "Load more drafts"}
        </button>
      )}
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
