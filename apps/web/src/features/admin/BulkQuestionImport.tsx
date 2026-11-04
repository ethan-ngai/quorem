/** @file BulkQuestionImport.tsx @description Review and resume a batch of question drafts. @module admin */
import { useRef, useState } from "react";
import type { QuestionContent } from "@quorem/contracts";
import { SessionDialog } from "../../ui/SessionDialog";
import { userFacingErrorMessage } from "../../ui/errors";
import { importDraft } from "./api";
import { parseQuestionImport, questionImportLimit } from "./importQuestion";

type Row = {
  name: string;
  content?: QuestionContent;
  file?: File;
  status: "pending" | "ready" | "created" | "existing" | "conflict" | "invalid" | "failed";
  selected: boolean;
  message?: string;
  draftId?: string;
};
type ManifestEntry = { file: string; sha256: string; leetcodeId?: number };

function manifestEntries(value: unknown): Map<string, ManifestEntry> {
  if (
    !value ||
    typeof value !== "object" ||
    !("fixtures" in value) ||
    !Array.isArray(value.fixtures)
  )
    throw new Error("Invalid fixture manifest.");
  const entries = new Map<string, ManifestEntry>();
  for (const entry of value.fixtures as ManifestEntry[]) {
    if (
      !entry ||
      typeof entry.file !== "string" ||
      /[\\/]/.test(entry.file) ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      entries.has(entry.file)
    )
      throw new Error("Invalid or duplicate fixture manifest entry.");
    entries.set(entry.file, entry);
  }
  if (!("fixture_count" in value) || value.fixture_count !== entries.size)
    throw new Error("Fixture manifest count does not match.");
  return entries;
}

async function fileText(file: File, entry?: ManifestEntry) {
  if (file.size > questionImportLimit) throw new Error("File exceeds 2 MiB.");
  const bytes = await file.arrayBuffer();
  if (entry) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (entry.sha256 !== hash) throw new Error("File hash does not match the manifest.");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function downloadReport(rows: Row[]) {
  const summary = rows.map(({ name, content, status, draftId, message }) => ({
    file: name,
    slug: content?.problem.slug,
    leetcodeId: content?.problem.leetcodeId,
    status,
    draftId,
    message,
  }));
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "question-import-results.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const eligible = (row: Row) =>
  row.status === "pending" || row.status === "ready" || row.status === "failed";
export function BulkQuestionImport({
  open,
  onOpenChange,
  onCreated,
  onOpenDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  onOpenDraft: (id: string) => void;
}) {
  const chooser = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  async function select(files: File[]) {
    setBusy(true);
    setRows([]);
    setNotice("");
    try {
      if (files.length > 1001)
        throw new Error("Choose at most 1,000 question files and a manifest.");
      const manifests = files.filter((file) => file.name === "manifest.json");
      if (manifests.length > 1) throw new Error("Choose a single fixture manifest.");
      const manifest = manifests[0] && manifestEntries(JSON.parse(await fileText(manifests[0])));
      const names = new Set<string>();
      const slugs = new Set<string>();
      const sourceIds = new Set<number>();
      const next: Row[] = [];
      for (const file of files) {
        if (file.name === "manifest.json") continue;
        try {
          if (names.has(file.name)) throw new Error("Duplicate filename.");
          names.add(file.name);
          const entry = manifest ? manifest.get(file.name) : undefined;
          if (manifest && !entry) throw new Error("File is missing from the selected manifest.");
          const content = parseQuestionImport(await fileText(file, entry));
          const { slug, leetcodeId } = content.problem;
          if (entry?.leetcodeId !== undefined && entry.leetcodeId !== leetcodeId)
            throw new Error("LeetCode ID does not match the manifest.");
          if (slugs.has(slug) || (leetcodeId != null && sourceIds.has(leetcodeId)))
            throw new Error("Duplicate slug or LeetCode ID in this selection.");
          slugs.add(slug);
          if (leetcodeId != null) sourceIds.add(leetcodeId);
          next.push({ name: file.name, content, file, status: "pending", selected: true });
        } catch (error) {
          next.push({
            name: file.name,
            status: "invalid",
            selected: false,
            message: error instanceof Error ? error.message : "Could not read the file.",
          });
        }
      }
      setRows(next);
      if (!next.length) setNotice("Choose at least one question JSON file.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not read the selection.");
    } finally {
      setBusy(false);
    }
  }
  async function run(preview: boolean) {
    const selected = rows.filter((row) => row.selected && eligible(row));
    setBusy(true);
    setNotice("");
    let created = false;
    let processed = 0;
    let next = 0;
    let paused = false;
    setProgress(`${preview ? "Checking" : "Importing"} 0 of ${selected.length}`);
    async function worker() {
      while (!paused && next < selected.length) {
        const row = selected[next++];
        let update: Partial<Row>;
        try {
          const raw = await fileText(row.file!);
          if (paused) return;
          const response = await importDraft(raw, row.content!, preview);
          if (response.status === 401 || response.status === 403 || response.status === 429) {
            if (paused) return;
            paused = true;
            setNotice(
              response.status === 429
                ? "Import paused. Wait briefly, then retry the remaining files."
                : "Import paused. Check your session and authoring access, then retry.",
            );
            return;
          }
          if (response.data) {
            update = {
              status: response.data.status,
              draftId: response.data.draftId,
              message: response.data.message ?? response.data.warning,
            };
            created ||= response.data.status === "created";
          } else {
            update = {
              status: "failed",
              message: "Server rejected this file. Retry or review its contents.",
            };
          }
        } catch (cause) {
          update = {
            status: "failed",
            message: userFacingErrorMessage(cause, "Request failed. Retry safely."),
          };
        }
        processed++;
        setProgress(`${preview ? "Checking" : "Importing"} ${processed} of ${selected.length}`);
        setRows((current) => current.map((item) => (item === row ? { ...item, ...update } : item)));
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(4, selected.length) }, worker));
    } finally {
      if (created) onCreated();
      setProgress("");
      setBusy(false);
    }
  }
  const selectedCount = rows.filter((row) => row.selected && eligible(row)).length;
  return (
    <SessionDialog
      open={open}
      onOpenChange={onOpenChange}
      pending={busy}
      title="Bulk import questions"
      description="Select question JSON files and an optional manifest. Import creates drafts for review."
      className="question-import-dialog"
    >
      <input
        ref={chooser}
        type="file"
        accept=".json,application/json"
        multiple
        hidden
        aria-label="Question JSON files"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length) void select(files);
        }}
      />
      <div className="question-import-actions">
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() => chooser.current?.click()}
        >
          Choose files
        </button>
        {rows.length > 0 && (
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => downloadReport(rows)}
          >
            Download results
          </button>
        )}
      </div>
      <p role="status">
        {progress ||
          notice ||
          (rows.length
            ? `${rows.length} files · ${rows.filter((r) => r.status === "created" || r.status === "existing").length} drafts`
            : "")}
      </p>
      {rows.length > 0 && (
        <ul className="question-import-rows" aria-label="Import files">
          {rows.map((row, index) => (
            <li key={index} className="question-import-row">
              <input
                type="checkbox"
                aria-label={`Select ${row.name}`}
                checked={row.selected}
                disabled={busy || !eligible(row)}
                onChange={(event) => {
                  const selected = event.currentTarget.checked;
                  setRows((current) =>
                    current.map((item, i) => (i === index ? { ...item, selected } : item)),
                  );
                }}
              />
              <div>
                <strong>{row.content?.problem.title ?? row.name}</strong>
                {row.content && (
                  <small>
                    {row.name} · {row.content.problem.slug}
                    {row.content.problem.leetcodeId != null
                      ? ` · #${row.content.problem.leetcodeId}`
                      : ""}
                  </small>
                )}
                {row.message && <small>{row.message}</small>}
              </div>
              {row.draftId ? (
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => onOpenDraft(row.draftId!)}
                >
                  Open draft
                </button>
              ) : (
                <span>{row.status}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <footer className="competitive-dialog-actions">
        <button
          className="button button-secondary"
          disabled={busy || !selectedCount}
          onClick={() => void run(true)}
        >
          Check files
        </button>
        <button
          className="button button-primary"
          disabled={busy || !selectedCount}
          onClick={() => void run(false)}
        >
          Create {selectedCount || ""} drafts
        </button>
      </footer>
    </SessionDialog>
  );
}
