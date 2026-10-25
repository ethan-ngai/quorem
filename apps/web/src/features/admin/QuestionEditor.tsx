import { useBlocker } from "@tanstack/react-router";
import { LoadingScreen } from "../../ui/LoadingScreen";
import { SegmentedControl } from "../../ui/SegmentedControl";
/** @file QuestionEditor.tsx @description Form-based immutable question authoring. @module admin */
import { useErrorNotification } from "../../ui/Notifications";
import { UserFacingError, userFacingErrorMessage } from "../../ui/errors";
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QuestionContent, QuestionDraft } from "@quorem/contracts";
import { GlobalNav } from "../navigation/GlobalNav";
import { useSession } from "../auth/session";
import { useTheme } from "../editor/useTheme";
import { api, requireData } from "../../api/client";
import { createDraft, getDraft, listDrafts, publishDraft, saveDraft } from "./api";
import { blankQuestion } from "./content";
import { QuestionFields, PublicPreview } from "./QuestionFields";
import { ProblemPicker } from "../practice/ProblemPicker";
import { Globe, LockKeyhole, FileJson } from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import "../../ui/question-hints.css";
import { SessionDialog } from "../../ui/SessionDialog";
import { PreviewBoundary } from "./PreviewBoundary";
import { parseQuestionImport, questionImportLimit } from "./importQuestion";
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
  const importInput = useRef<HTMLInputElement>(null);
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
      <header className="admin-heading">
        <div>
          <h1>Question editor</h1>
        </div>
        <div className="admin-toolbar">
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            aria-label="Import question JSON file"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              void perform(async () => {
                if (file.size > questionImportLimit)
                  throw new UserFacingError("Choose a JSON file smaller than 2 MiB.");
                return createDraft({ content: parseQuestionImport(await file.text()) });
              }, "Question imported. Review the draft before publishing.");
            }}
          />
          <button
            className="button button-secondary"
            disabled={busy || dirty || invalidFields.size > 0}
            onClick={() => importInput.current?.click()}
          >
            Import JSON
          </button>
          <button
            className="button button-secondary"
            disabled={busy || dirty || invalidFields.size > 0}
            onClick={() =>
              void perform(() => createDraft({ content: blankQuestion() }), "Draft created.")
            }
          >
            New question
          </button>
        </div>
      </header>
      <div className="admin-layout">
        <aside className="admin-rail" aria-label="Question drafts">
          <label>
            Edit published question
            <ProblemPicker
              items={problems.data ?? []}
              value={cloneId}
              onChange={(id) => setCloneId(id ?? "")}
              disabled={busy}
              label="Edit published question"
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
                onClick={() => discardTarget && void perform(() => getDraft(discardTarget), "")}
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
                    {admin && (
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
                          () => publishDraft(draft, admin ? visibility : "private"),
                          admin && visibility === "global"
                            ? "Global question published."
                            : "Question added to your private library.",
                        )
                      }
                    >
                      {busy
                        ? "Working…"
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
