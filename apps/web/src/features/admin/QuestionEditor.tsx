/** @file QuestionEditor.tsx @description Form-based immutable question authoring. @module admin */
import { useErrorNotification } from "../../ui/Notifications";
import { userFacingErrorMessage } from "../../ui/errors";
import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QuestionContent, QuestionDraft } from "@quorem/contracts";
import { GlobalNav } from "../navigation/GlobalNav";
import { useSession } from "../auth/session";
import { useTheme } from "../editor/useTheme";
import { api, requireData } from "../editor/api";
import { createDraft, getDraft, listDrafts, publishDraft, saveDraft } from "./api";
import { blankQuestion } from "./content";
import { QuestionFields, PublicPreview } from "./QuestionFields";
import { SelectField } from "../../ui/SelectField";
import * as Dialog from "@radix-ui/react-dialog";
import { PreviewBoundary } from "./PreviewBoundary";
import "./admin.css";

/** Gates navigation as well as operations; API authorization remains authoritative. */
export function QuestionEditor() {
  const session = useSession();
  const theme = useTheme();
  return (
    <>
      <GlobalNav theme={theme.preference} onThemeChange={theme.setPreference} />
      {session.isPending ? (
        <main className="admin-access" role="status">
          Checking account…
        </main>
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
  const drafts = useInfiniteQuery({
    queryKey: ["admin-drafts", admin],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listDrafts(pageParam),
    getNextPageParam: (page) => page.nextCursor,
  });
  const draftItems = drafts.data?.pages.flatMap((page) => page.items);
  const problems = useQuery({
    queryKey: ["admin-problems", admin],
    queryFn: async () => {
      const { data, error } = await api().GET("/v1/problems", {
        params: { query: { limit: 100, ...(admin ? {} : { library: "private" as const }) } },
      });
      return requireData(data, error).items;
    },
  });
  const [draft, setDraft] = useState<QuestionDraft>();
  const [content, setContent] = useState<QuestionContent>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useErrorNotification(error);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const [cloneId, setCloneId] = useState("");
  const [discardTarget, setDiscardTarget] = useState<string>();
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
    setDraft(next);
    setContent(next.content);
    setDirty(false);
    setPreview(false);
    setError("");
    setNotice("");
    setDiscardTarget(undefined);
    setInvalidFields(new Set());
  }
  async function perform(action: () => Promise<QuestionDraft>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      open(await action());
      setNotice(message);
      await cache.invalidateQueries({ queryKey: ["admin-drafts"] });
      await cache.invalidateQueries({ queryKey: ["admin-problems"] });
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "Request failed"));
    } finally {
      setBusy(false);
    }
  }
  const locked = !!draft?.publishedVersionId || busy;
  return (
    <main className="admin-workspace">
      <header className="admin-heading">
        <div>
          <h1>Question editor</h1>
          <p>
            {admin ? "Publish global questions." : "Create questions for your private library."}
          </p>
        </div>
        <button
          className="button button-secondary"
          disabled={busy || dirty || invalidFields.size > 0}
          onClick={() =>
            void perform(() => createDraft({ content: blankQuestion() }), "Draft created.")
          }
        >
          New question
        </button>
      </header>
      <div className="admin-layout">
        <aside className="admin-rail" aria-label="Question drafts">
          <label>
            Edit published question
            <SelectField
              label="Edit published question"
              value={cloneId}
              onChange={setCloneId}
              options={[
                { value: "", label: "Choose question" },
                ...(problems.data?.map((item) => ({ value: item.id, label: item.title })) ?? []),
              ]}
              disabled={busy}
            />
          </label>
          <button
            className="button button-secondary"
            disabled={!cloneId || busy || dirty || invalidFields.size > 0}
            onClick={() =>
              void perform(
                () => createDraft({ problemVersionId: cloneId }),
                "New version draft created.",
              )
            }
          >
            Create version draft
          </button>
          <h2>Drafts</h2>
          {drafts.isPending ? (
            <p role="status">Loading drafts…</p>
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
                    : void perform(() => getDraft(item.id), "")
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
        </aside>
        <section className="admin-form-pane" aria-label="Question content">
          <Dialog.Root
            open={!!discardTarget}
            onOpenChange={(open) => {
              if (!open) setDiscardTarget(undefined);
            }}
          >
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay" />
              <Dialog.Content className="dialog-content competitive-dialog">
                <Dialog.Title>Discard unsaved edits?</Dialog.Title>
                <Dialog.Description>Your saved draft will remain unchanged.</Dialog.Description>
                <footer className="competitive-dialog-actions">
                  <Dialog.Close asChild>
                    <button className="button button-secondary">Keep editing</button>
                  </Dialog.Close>
                  <button
                    className="button button-primary"
                    onClick={() => discardTarget && void perform(() => getDraft(discardTarget), "")}
                  >
                    Discard and open
                  </button>
                </footer>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
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
                  <button
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        () => createDraft({ problemVersionId: draft.publishedVersionId! }),
                        "New version draft created.",
                      )
                    }
                  >
                    Create next version
                  </button>
                ) : (
                  <>
                    <button
                      className="button button-secondary"
                      disabled={busy || !dirty || invalidFields.size > 0}
                      onClick={() => void perform(() => saveDraft(draft, content), "Draft saved.")}
                    >
                      Save draft
                    </button>
                    <button
                      className="button button-primary"
                      disabled={busy || dirty || invalidFields.size > 0}
                      onClick={() =>
                        void perform(
                          () => publishDraft(draft),
                          admin
                            ? "Global question published."
                            : "Question added to your private library.",
                        )
                      }
                    >
                      {busy ? "Working…" : admin ? "Publish globally" : "Save to private library"}
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
