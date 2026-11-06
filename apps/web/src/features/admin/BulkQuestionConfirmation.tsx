/** @file BulkQuestionConfirmation.tsx @description Compact bulk-action intent and optional selection review. @module admin */
import { useState } from "react";
import { ChevronRight, Globe, ListChecks, LockKeyhole, Trash2, Upload } from "lucide-react";
import { SessionDialog } from "../../ui/SessionDialog";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { SearchField } from "../../ui/SearchField";
import "./bulk-question-confirmation.css";

type Question = {
  id: string;
  title: string;
  version?: string | number;
  revision?: string;
  editVersionId?: string;
};

export function BulkQuestionConfirmation({
  action,
  questions,
  scope,
  admin,
  visibility,
  onVisibilityChange,
  running,
  stopping = false,
  onCancel,
  onClose,
  onConfirm,
}: {
  action?: "publish" | "delete";
  questions: readonly Question[];
  scope: "drafts" | "publications";
  admin: boolean;
  visibility: "private" | "global";
  onVisibilityChange: (visibility: "private" | "global") => void;
  running: boolean;
  stopping?: boolean;
  onCancel?: () => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [query, setQuery] = useState("");
  const publish = action === "publish";
  const newDrafts = questions.some(
    (question) => question.revision !== undefined && !question.editVersionId,
  );
  const updates = questions.some((question) => !!question.editVersionId);
  const visible = questions.filter((question) =>
    question.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <SessionDialog
      open={!!action}
      pending={running}
      onExited={() => setQuery("")}
      onOpenChange={(open) => {
        if (!open && !running) onClose();
      }}
      title={`${publish ? "Publish" : "Delete"} ${questions.length} ${publish || scope === "drafts" ? "drafts" : "versions"}?`}
      descriptionHidden={publish && !updates}
      description={
        publish
          ? updates
            ? "Updates keep their existing visibility."
            : "Choose where to publish new questions."
          : scope === "drafts"
            ? "Removes these drafts and their imported content."
            : "Selected current versions will be unpublished. Other versions stay available."
      }
    >
      {publish && admin && newDrafts && (
        <div className="bulk-publication-target">
          <span>Publish to</span>
          <SegmentedControl
            label="Publication visibility"
            value={visibility}
            onChange={onVisibilityChange}
            disabled={running}
            options={[
              {
                value: "private",
                label: "My library",
                icon: <LockKeyhole size={15} aria-hidden="true" />,
                hint: "Only available in your library.",
              },
              {
                value: "global",
                label: "Global catalog",
                icon: <Globe size={15} aria-hidden="true" />,
                hint: "Available to everyone.",
              },
            ]}
          />
        </div>
      )}
      <details className="disclosure bulk-question-review">
        <summary>
          <ListChecks size={15} aria-hidden="true" />
          Review selection
          <ChevronRight size={14} className="disclosure-chevron" aria-hidden="true" />
        </summary>
        {questions.length > 8 && (
          <SearchField
            aria-label="Filter selected questions"
            placeholder="Find a selected question…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        <ul className="bulk-review-list" aria-label="Selected questions">
          {visible.map((question) => (
            <li key={question.id}>
              <span>{question.title || "Untitled question"}</span>
              {question.version !== undefined && (
                <span className="mono-text">v{question.version}</span>
              )}
            </li>
          ))}
        </ul>
        {!visible.length && <p className="bulk-review-empty">No matching questions.</p>}
      </details>
      <footer className="competitive-dialog-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={running && (stopping || !onCancel)}
          onClick={running ? onCancel : onClose}
        >
          {running ? "Stop remaining" : "Cancel"}
        </button>
        <button
          type="button"
          className={`button ${publish ? "button-primary" : "button-danger"}`}
          disabled={running || !questions.length}
          onClick={onConfirm}
        >
          {publish ? (
            <Upload size={14} aria-hidden="true" />
          ) : (
            <Trash2 size={14} aria-hidden="true" />
          )}
          {running ? (publish ? "Publishing…" : "Deleting…") : publish ? "Publish" : "Delete"}
        </button>
      </footer>
    </SessionDialog>
  );
}
