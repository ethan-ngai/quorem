import { useBlocker } from "@tanstack/react-router";
import { LoadingScreen } from "../../ui/LoadingScreen";
import { SegmentedControl } from "../../ui/SegmentedControl";
/** @file QuestionEditor.tsx @description Form-based question authoring. @module admin */
import { useErrorNotification } from "../../ui/Notifications";
import { userFacingErrorMessage } from "../../ui/errors";
import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QuestionContent, QuestionDraft } from "@quorem/contracts";
import { GlobalNav } from "../navigation/GlobalNav";
import { useSession } from "../auth/session";
import { useTheme } from "../editor/useTheme";
import {
  createDraft,
  deleteQuestionPublication,
  fetchDeletionImpact,
  getDraft,
  listDrafts,
  listPublications,
  publishDraft,
  saveDraft,
} from "./api";
import { blankQuestion } from "./content";
import { QuestionFields, PublicPreview } from "./QuestionFields";
import { Globe, LockKeyhole, FileJson } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import "../../ui/question-hints.css";
import { SessionDialog } from "../../ui/SessionDialog";
import { PreviewBoundary } from "./PreviewBoundary";
import { BulkQuestionImport } from "./BulkQuestionImport";
import questionSchema from "@quorem/contracts/questions/schema?url";
import "./admin.css";

/** Gates navigation as well as operations; API authorization remains authoritative. */
export function QuestionEditor() {
  const session = useSession();
  const theme = useTheme();
  return (
    <>
      <GlobalNav theme={theme.preference} onThemeChange={theme.setPreference} />
      {session.isPending ? (
        <LoadingScreen label="Checking account…" />
      ) : session.isError ? (
        <main className="admin-access" role="alert">
          Account unavailable. Reload to retry.
        </main>
      ) : !session.data ? (
        <main className="admin-access">
          <h1>Sign in required</h1>
          <a href="/login">Sign in</a>
        </main>
      ) : session.data.user.role !== "admin" &&
        !session.data.capabilities?.authorCustomQuestions ? (
        <main className="admin-access">
          <h1>Question authoring access required</h1>
          <p>Your account cannot edit questions.</p>
          <a href="/practice">Return to practice</a>
        </main>
      ) : (
        <AuthoringWorkspace admin={session.data.user.role === "admin"} />
      )}
    </>
  );
}

/** Keeps unsaved edits local; changing drafts requires an explicit discard. */
function AuthoringWorkspace({ admin }: { admin: boolean }) {
  const cache = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const drafts = useInfiniteQuery({
    queryKey: ["admin-drafts", admin],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listDrafts(pageParam),
    getNextPageParam: (page) => page.nextCursor,
  });
  const draftItems = drafts.data?.pages
    .flatMap((page) => page.items)
    .filter((item) => !item.publishedVersionId);
  const problems = useQuery({
    queryKey: ["admin-problems", admin],
    queryFn: listPublications,
  });
  const [draft, setDraft] = useState<QuestionDraft>();
  const [content, setContent] = useState<QuestionContent>();
  const [dirty, setDirty] = useState(false);
  const navigationBlocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: false,
    withResolver: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useErrorNotification(error);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const [visibility, setVisibility] = useState<"private" | "global">("private");
  const [cloneId, setCloneId] = useState("");
  const [discardTarget, setDiscardTarget] = useState<string>();
  const [deletion, setDeletion] = useState<Awaited<ReturnType<typeof fetchDeletionImpact>>>();
  const [replacement, setReplacement] = useState("");
  async function requestDeletion() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      setDeletion(await fetchDeletionImpact(draft.id));
      setReplacement("");
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "Could not check what this version is used by."));
    } finally {
      setBusy(false);
    }
  }
  async function confirmDeletion() {
    if (!draft || !deletion || (deletion.current && !replacement)) return;
    setBusy(true);
    setError("");
    try {
      await deleteQuestionPublication(
        draft,
        deletion.current ? (replacement === "unpublish" ? null : replacement) : undefined,
      );
      setDeletion(undefined);
      setDraft(undefined);
      setContent(undefined);
      setCloneId("");
      setNotice("Published version deleted.");
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["admin-drafts"] }),
        cache.invalidateQueries({ queryKey: ["admin-problems"] }),
      ]);
    } catch (cause) {
      setDeletion(undefined);
      setError(userFacingErrorMessage(cause, "Could not delete the published version."));
    } finally {
      setBusy(false);
    }
  }
  const versionHistory = useQuery({
    queryKey: ["admin-publication-impact", draft?.id, draft?.revision],
    enabled: !!draft?.publishedVersionId,
    queryFn: () => fetchDeletionImpact(draft!.id),
  });
  const [invalidFields, setInvalidFields] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function open(next: QuestionDraft) {
    setVisibility((current) => (next.id === draft?.id ? current : "private"));
    setDraft(next);
    setContent(next.content);
    setDirty(false);
    setPreview(false);
    setError("");
    setNotice("");
    setDiscardTarget(undefined);
    setInvalidFields(new Set());
  }
  async function perform(action: () => Promise<QuestionDraft>, message: string, failure: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      open(await action());
      setNotice(message);
      await cache.invalidateQueries({ queryKey: ["admin-drafts"] });
      await cache.invalidateQueries({ queryKey: ["admin-problems"] });
      await cache.invalidateQueries({ queryKey: ["admin-publication-impact"] });
    } catch (cause) {
      setError(userFacingErrorMessage(cause, failure));
    } finally {
      setBusy(false);
    }
  }
  const locked = busy;
  return (
    <main className="admin-workspace">
      <SessionDialog
        open={navigationBlocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) navigationBlocker.reset?.();
        }}
        title="Discard unsaved edits?"
        description="Your saved draft will remain unchanged."
      >
        <footer className="competitive-dialog-actions">
          <button className="button button-secondary" onClick={() => navigationBlocker.reset?.()}>
            Keep editing
          </button>
          <button className="button button-primary" onClick={() => navigationBlocker.proceed?.()}>
            Discard and leave
          </button>
        </footer>
      </SessionDialog>
      <SessionDialog
        open={!!deletion}
        onOpenChange={(value) => {
          if (!value && !busy) setDeletion(undefined);
        }}
        title="Delete published version?"
        description={
          deletion
            ? `This removes question content and results from ${deletion.submissions} practice attempts. It detaches ${deletion.workspaces} workspaces and ${deletion.matches} matches.`
            : ""
        }
      >
        {deletion?.current && (
          <label>
            Current question
            <select
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              disabled={busy}
            >
              <option value="">Choose what to publish</option>
              <option value="unpublish">Unpublish question</option>
              {deletion.replacements.map((version) => (
                <option key={version.id} value={version.id}>
                  Version {version.version} · {version.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <footer className="competitive-dialog-actions">
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={() => setDeletion(undefined)}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={busy || (deletion?.current && !replacement)}
            onClick={() => void confirmDeletion()}
          >
            Delete version
          </button>
        </footer>
      </SessionDialog>
      <BulkQuestionImport
        open={importOpen}
        onOpenChange={setImportOpen}
        onCreated={() => void cache.invalidateQueries({ queryKey: ["admin-drafts"] })}
        onOpenDraft={(id) => {
          setImportOpen(false);
          void perform(() => getDraft(id), "", "Could not open the imported draft.");
        }}
      />
      <header className="admin-heading">
        <div>
          <h1>Question editor</h1>
        </div>
        <div className="admin-toolbar">
          <button
            className="button button-secondary"
            disabled={busy || dirty || invalidFields.size > 0}
            onClick={() => setImportOpen(true)}
          >
            Bulk import
          </button>
          <button
            className="button button-secondary"
            disabled={busy || dirty || invalidFields.size > 0}
            onClick={() =>
              void perform(
                () => createDraft({ content: blankQuestion() }),
                "Draft created.",
                "Could not create the draft. Try again.",
              )
            }
          >
            New question
          </button>
        </div>
      </header>
      <div className="admin-layout">
        <aside className="admin-rail" aria-label="Question drafts">
          <div className="admin-picker">
            <label htmlFor="admin-publication">Published questions</label>
            <select
              id="admin-publication"
              value={cloneId}
              onChange={(event) => setCloneId(event.target.value)}
              disabled={busy}
            >
              <option value="">Choose a question</option>
              {problems.data?.map((question) => (
                <option key={question.id} value={question.id}>
                  {question.title}
                  {question.current ? "" : " · Unpublished"}
                </option>
              ))}
            </select>
          </div>
          <button
            className="button button-secondary"
            disabled={!cloneId || busy || dirty || invalidFields.size > 0}
            onClick={() =>
              void perform(
                () => createDraft({ problemVersionId: cloneId, edit: true }),
                "",
                "Could not open the published question.",
              )
            }
          >
            Open published question
          </button>
          <h2>Drafts</h2>
          {drafts.isPending ? (
            <LoadingScreen inline label="Loading drafts…" />
          ) : drafts.isError ? (
            <p role="alert">
              {userFacingErrorMessage(drafts.error, "Questions unavailable. Please try again.")}
            </p>
          ) : !draftItems?.length ? (
            <p>No drafts yet.</p>
          ) : (
            draftItems.map((item) => (
              <button
                key={item.id}
                className="admin-draft-row"
                aria-current={draft?.id === item.id ? "page" : undefined}
                disabled={busy}
                onClick={() =>
                  dirty || invalidFields.size > 0
                    ? setDiscardTarget(item.id)
                    : void perform(
                        () => getDraft(item.id),
                        "",
                        "Could not open the draft. Try again.",
                      )
                }
              >
                <span>{item.title || "Untitled question"}</span>
                <small>{item.publishedVersionId ? "Published" : "Draft"}</small>
              </button>
            ))
          )}
          {drafts.hasNextPage && (
            <button
              className="button button-secondary"
              disabled={drafts.isFetchingNextPage}
              onClick={() => void drafts.fetchNextPage()}
            >
              Load more drafts
            </button>
          )}
          <div className="admin-rail-tools">
            <Tooltip content="Download question JSON schema">
              <a
                className="icon-button"
                href={questionSchema}
                download="quorem-question-v1.schema.json"
                aria-label="Download question JSON schema"
              >
                <FileJson size={16} />
              </a>
            </Tooltip>
          </div>
        </aside>
        <section className="admin-form-pane" aria-label="Question content">
          <SessionDialog
            open={!!discardTarget}
            onOpenChange={(open) => {
              if (!open) setDiscardTarget(undefined);
            }}
            title="Discard unsaved edits?"
            description="Your saved draft will remain unchanged."
          >
            <footer className="competitive-dialog-actions">
              <button
                className="button button-secondary"
                onClick={() => setDiscardTarget(undefined)}
              >
                Keep editing
              </button>
              <button
                className="button button-primary"
                onClick={() =>
                  discardTarget &&
                  void perform(
                    () => getDraft(discardTarget),
                    "",
                    "Could not open the draft. Try again.",
                  )
                }
              >
                Discard and open
              </button>
            </footer>
          </SessionDialog>
          {!content || !draft ? (
            <p>Select a draft or create a question.</p>
          ) : (
            <>
              <div className="admin-toolbar">
                <span role="status">
                  {draft.publishedVersionId
                    ? "Published version"
                    : dirty
                      ? "Unsaved edits"
                      : "Saved draft"}
                </span>
                <button
                  className="quiet-button"
                  disabled={invalidFields.size > 0}
                  onClick={() => setPreview(!preview)}
                >
                  {preview ? "Edit content" : "Preview public content"}
                </button>
                {draft.publishedVersionId ? (
                  <>
                    {!!versionHistory.data?.replacements.length && (
                      <select
                        aria-label="Published versions"
                        value={draft.publishedVersionId}
                        disabled={busy || dirty || invalidFields.size > 0}
                        onChange={(event) => {
                          const id = event.target.value;
                          void perform(
                            () => createDraft({ problemVersionId: id, edit: true }),
                            "",
                            "Could not open the version.",
                          );
                        }}
                      >
                        <option value={draft.publishedVersionId}>
                          Version {content.problem.version}
                        </option>
                        {versionHistory.data.replacements.map((version) => (
                          <option key={version.id} value={version.id}>
                            Version {version.version} · {version.title}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      className="button button-primary"
                      disabled={busy || !dirty || invalidFields.size > 0}
                      onClick={() =>
                        void perform(
                          () => saveDraft(draft, content),
                          "Published changes saved.",
                          "Could not save the published changes. Your edits are still here.",
                        )
                      }
                    >
                      Save published changes
                    </button>
                    <button
                      className="button button-secondary"
                      disabled={busy || dirty || invalidFields.size > 0}
                      onClick={() =>
                        void perform(
                          () => createDraft({ problemVersionId: draft.publishedVersionId! }),
                          "New version draft created.",
                          "Could not create a version draft. Try again.",
                        )
                      }
                    >
                      Create next version
                    </button>
                    <button
                      className="quiet-button"
                      disabled={busy || dirty}
                      onClick={() => void requestDeletion()}
                    >
                      Delete version
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="button button-secondary"
                      disabled={busy || !dirty || invalidFields.size > 0}
                      onClick={() =>
                        void perform(
                          () => saveDraft(draft, content),
                          "Draft saved.",
                          "Could not save the draft. Your edits are still here.",
                        )
                      }
                    >
                      Save draft
                    </button>
                    {admin && !draft.editVersionId && (
                      <SegmentedControl
                        label="Publish to"
                        iconOnly
                        value={visibility}
                        disabled={busy}
                        onChange={(value) => setVisibility(value as "private" | "global")}
                        options={[
                          {
                            value: "private",
                            label: "Private",
                            icon: <LockKeyhole size={16} aria-hidden="true" />,
                          },
                          {
                            value: "global",
                            label: "Global",
                            icon: <Globe size={16} aria-hidden="true" />,
                          },
                        ]}
                      />
                    )}
                    <button
                      className="button button-primary"
                      disabled={busy || dirty || invalidFields.size > 0}
                      onClick={() =>
                        void perform(
                          () =>
                            publishDraft(
                              draft,
                              draft.editVersionId ? "global" : admin ? visibility : "private",
                            ),
                          draft.editVersionId
                            ? "Published changes saved."
                            : admin && visibility === "global"
                              ? "Global question published."
                              : "Question added to your private library.",
                          "Could not publish the question. Try again.",
                        )
                      }
                    >
                      {busy
                        ? "Working…"
                        : draft.editVersionId
                          ? "Apply update"
                          : admin && visibility === "global"
                            ? "Publish globally"
                            : "Add to library"}
                    </button>
                  </>
                )}
              </div>
              {preview ? (
                <PreviewBoundary>
                  <PublicPreview content={content} />
                </PreviewBoundary>
              ) : (
                <QuestionFields
                  key={`${draft.id}:${draft.revision}`}
                  content={content}
                  disabled={locked}
                  lockSlug={!!(draft.publishedVersionId || draft.editVersionId)}
                  invalidCases={[...invalidFields].some((key) => key.startsWith("cases:"))}
                  onValidityChange={(label, invalid) => (
                    invalid && setDirty(true),
                    setInvalidFields((previous) => {
                      const next = new Set(previous);
                      if (invalid) next.add(label);
                      else next.delete(label);
                      return next;
                    })
                  )}
                  onChange={(next) => {
                    setContent(next);
                    setDirty(true);
                    setNotice("");
                  }}
                />
              )}
              {draft.publishedVersionId && (
                <p>
                  <a href={`/practice/${encodeURIComponent(content.problem.slug)}`}>
                    Open published question
                  </a>
                </p>
              )}
            </>
          )}

          {notice && (
            <p className="admin-notice" role="status">
              {notice}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
