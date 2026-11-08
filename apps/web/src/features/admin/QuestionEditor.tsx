import { toast } from "sonner";
import {
  updateAuthoringIssues,
  authoringMessages,
  type AuthoringIssue,
} from "./authoringValidation";
import { PersistentNotice } from "../../ui/PersistentNotice";
import * as Popover from "../../ui/Popover";
import { QuestionLanguage } from "../editor/QuestionLanguage";
import type { EditorLanguage } from "../editor/editorLanguages";
import { Link, useBlocker, useNavigate, useSearch } from "@tanstack/react-router";
import { QuestionDashboard } from "./QuestionDashboard";
import { LoadingScreen } from "../../ui/LoadingScreen";
import { scopedPlaceholder } from "../../ui/scopedPlaceholder";
import { SelectField } from "../../ui/SelectField";
import { useChangeMotion } from "../../ui/useChangeMotion";
import { SegmentedControl } from "../../ui/SegmentedControl";
/** @file QuestionEditor.tsx @description Form-based question authoring. @module admin */
import { useErrorNotification } from "../../ui/Notifications";
import { userFacingErrorMessage } from "../../ui/errors";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QuestionContent, QuestionDraft } from "@quorem/contracts";
import { GlobalNav } from "../navigation/GlobalNav";
import { usePageTitle } from "../navigation/PageMetadata";
import { useSession } from "../auth/session";
import type { EditorTheme } from "../editor/PythonEditor";
import { useLocalEditorPreferences } from "../settings/useLocalEditorPreferences";
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
import {
  ArrowLeft,
  ArrowUpRight,
  Ellipsis,
  Eye,
  FilePlus2,
  Globe,
  LockKeyhole,
  FileJson,
  Pencil,
  Save,
  Trash2,
} from "lucide-react";
import { Tooltip } from "../../ui/Tooltip";
import "../../ui/question-hints.css";
import { SessionDialog } from "../../ui/SessionDialog";
import { PreviewBoundary } from "./PreviewBoundary";
import { BulkQuestionImport } from "./BulkQuestionImport";
import questionSchema from "@quorem/contracts/questions/schema?url";
import "./admin.css";

/** Authoring access is owned by the route boundary and verified again by the API. */
export function QuestionEditor() {
  const session = useSession();
  const theme = useTheme();
  return (
    <>
      <GlobalNav theme={theme.preference} onThemeChange={theme.setPreference} />
      {session.data ? (
        <QuestionSelection
          admin={session.data.user.role === "admin"}
          userId={session.data.user.id}
          theme={theme.theme}
        />
      ) : null}
    </>
  );
}

function questionKey(userId: string, draft?: string, publication?: string) {
  return ["admin-open-question", "approaches", userId, draft, publication] as const;
}

function QuestionSelection({
  admin,
  userId,
  theme,
}: {
  admin: boolean;
  userId: string;
  theme: EditorTheme;
}) {
  const search = useSearch({ from: "/questions" });
  const { draft, publication } = search;
  const question = useQuery({
    queryKey: questionKey(userId, draft, publication),
    enabled: !!(draft || publication),
    retry: false,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: () =>
      publication ? createDraft({ problemVersionId: publication, edit: true }) : getDraft(draft!),
  });
  if (draft || publication) {
    if (question.isPending || question.isFetching)
      return <LoadingScreen label="Opening question…" />;
    if (!question.data)
      return (
        <main className="admin-workspace">
          <p role="alert">
            {userFacingErrorMessage(question.error, "Could not open the question.")}
          </p>
          <Link to="/questions" search={{ ...search, draft: undefined, publication: undefined }}>
            Back to questions
          </Link>
        </main>
      );
  }
  return (
    <AuthoringWorkspace
      key={`${userId}:${publication ?? draft ?? "catalog"}`}
      userId={userId}
      admin={admin}
      initialDraft={question.data}
      theme={theme}
    />
  );
}

/** Keeps unsaved edits local; changing drafts requires an explicit discard. */
function AuthoringWorkspace({
  admin,
  initialDraft,
  userId,
  theme,
}: {
  admin: boolean;
  userId: string;
  initialDraft?: QuestionDraft;
  theme: EditorTheme;
}) {
  const preferences = useLocalEditorPreferences();
  const cache = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const search = useSearch({ from: "/questions" });
  const navigate = useNavigate({ from: "/questions" });
  const { section, readiness, draft: draftId, publication, ...filters } = search;
  const draftScope = ["admin-drafts", userId, admin] as const;
  const publicationScope = ["admin-problems", userId, admin] as const;
  const drafts = useQuery({
    queryKey: [...draftScope, filters, readiness],
    placeholderData: scopedPlaceholder(draftScope),
    enabled: !initialDraft && section !== "publications",
    queryFn: ({ signal }) => listDrafts({ ...filters, readiness }, signal),
  });
  const draftItems = drafts.data?.items ?? [];
  const problems = useQuery({
    queryKey: [...publicationScope, filters],
    placeholderData: scopedPlaceholder(publicationScope),
    enabled: !initialDraft && section === "publications",
    queryFn: ({ signal }) => listPublications(filters, signal),
  });
  const questionList = section === "publications" ? problems : drafts;
  const [draft, setDraft] = useState<QuestionDraft | undefined>(initialDraft);
  const questionTitle = draft?.content.problem.title || "Untitled question";
  usePageTitle(
    draft
      ? `${questionTitle} - Question Editor`
      : `${section === "drafts" ? "Question Drafts" : "Published Questions"} - Quorem`,
  );
  const [content, setContent] = useState<QuestionContent | undefined>(initialDraft?.content);
  const [dirty, setDirty] = useState(false);
  const navigationBlocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: false,
    withResolver: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useErrorNotification(draft ? undefined : error);
  const [preview, setPreview] = useState(false);
  const [previewLanguage, setPreviewLanguage] =
    useState<Exclude<EditorLanguage, "postgresql">>("python");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [visibility, setVisibility] = useState<"private" | "global">("private");
  const [bulkRunning, setBulkRunning] = useState(false);
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
      cache.removeQueries({ queryKey: questionKey(userId, draftId, publication), exact: true });
      closeEditor();
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
  const saveStatus = dirty ? "Unsaved edits" : draft?.publishedVersionId ? "Published" : "Draft";
  const saveStatusElement = useChangeMotion<HTMLSpanElement>(saveStatus);
  const [invalidFields, setInvalidFields] = useState<Map<string, readonly AuthoringIssue[]>>(
    () => new Map(),
  );
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
    setInvalidFields(new Map());
  }
  function closeEditor() {
    void navigate({
      search: (previous) => ({ ...previous, draft: undefined, publication: undefined }),
    });
  }
  async function perform(action: () => Promise<QuestionDraft>, message: string, failure: string) {
    setBusy(true);
    setError("");
    try {
      const next = await action();
      const nextPublication = next.publishedVersionId;
      const nextDraft = nextPublication ? undefined : next.id;
      cache.setQueryData(questionKey(userId, nextDraft, nextPublication), next);
      if (nextDraft !== draftId || nextPublication !== publication) {
        await navigate({
          search: (previous) => ({ ...previous, draft: nextDraft, publication: nextPublication }),
          replace: !!draftId && !!nextPublication,
        });
      } else {
        open(next);
      }
      toast.success(message);
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
    <main className="admin-workspace" data-editing={!!draft}>
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
            <Trash2 size={16} aria-hidden="true" /> Delete version
          </button>
        </footer>
      </SessionDialog>
      <BulkQuestionImport
        open={importOpen}
        onOpenChange={setImportOpen}
        onCreated={() => void cache.invalidateQueries({ queryKey: ["admin-drafts"] })}
        onOpenDraft={(id) => {
          setImportOpen(false);
          void navigate({
            search: (previous) => ({ ...previous, draft: id, publication: undefined }),
          });
        }}
      />
      <header className="admin-heading">
        <h1>{draft ? questionTitle : "Questions"}</h1>
        <div className="admin-toolbar">
          {draft ? (
            <button className="button button-secondary" disabled={busy} onClick={closeEditor}>
              <ArrowLeft size={16} aria-hidden="true" /> Back to questions
            </button>
          ) : (
            <>
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
              <button
                className="button button-secondary"
                disabled={busy || bulkRunning}
                onClick={() => setImportOpen(true)}
              >
                Bulk import
              </button>
              <button
                className="button button-primary"
                disabled={busy || bulkRunning}
                onClick={() =>
                  void perform(
                    () => createDraft({ content: blankQuestion() }),
                    "Draft created.",
                    "Could not create the draft.",
                  )
                }
              >
                New question
              </button>
            </>
          )}
        </div>
      </header>
      {!draft && (
        <QuestionDashboard
          admin={admin}
          drafts={draftItems}
          publications={problems.data?.items ?? []}
          search={search}
          facets={section === "publications" ? problems.data?.facets : drafts.data?.facets}
          onSearch={(change, replace) =>
            void navigate({
              search: (previous) => ({ ...previous, page: undefined, ...change }),
              replace,
            })
          }
          loading={questionList.isPending}
          refreshing={questionList.isFetching && !!questionList.data}
          failed={questionList.isError}
          snapshot={questionList.isPlaceholderData ? questionList.data : undefined}
          busy={busy}
          onRunning={setBulkRunning}
          total={questionList.data?.total}
          onOpen={(row) =>
            void navigate({
              search: (previous) => ({
                ...previous,
                draft: "revision" in row ? row.id : undefined,
                publication: "revision" in row ? undefined : row.id,
              }),
            })
          }
          onChanged={() =>
            Promise.all([
              cache.invalidateQueries({ queryKey: ["admin-drafts"] }),
              cache.invalidateQueries({ queryKey: ["admin-problems"] }),
              cache.invalidateQueries({ queryKey: ["admin-publication-impact"] }),
            ])
          }
        />
      )}
      {draft && content && (
        <section className="admin-form-pane" aria-label="Question content">
          <div className="admin-toolbar admin-edit-toolbar">
            <span ref={saveStatusElement}>
              <span role="status">{saveStatus}</span>
              <PersistentNotice
                label={invalidFields.size ? "Saving blocked" : "Question update failed"}
                message={[...authoringMessages([...invalidFields.values()].flat()), error]}
              />
            </span>
            <Tooltip content={preview ? "Edit content" : "Preview public content"}>
              <button
                type="button"
                className="icon-button"
                aria-label={preview ? "Edit content" : "Preview public content"}
                aria-pressed={preview}
                disabled={invalidFields.size > 0}
                onClick={() => setPreview(!preview)}
              >
                {preview ? <Pencil size={17} /> : <Eye size={17} />}
              </button>
            </Tooltip>
            {draft.publishedVersionId && (
              <Tooltip content="Open published question">
                <Link
                  className="icon-button"
                  to="/practice/$slug"
                  params={{ slug: draft.content.problem.slug }}
                  aria-label="Open published question"
                >
                  <ArrowUpRight size={17} />
                </Link>
              </Tooltip>
            )}
            {draft.publishedVersionId ? (
              <>
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
                  <Save size={16} aria-hidden="true" /> Save changes
                </button>
                <Popover.Root open={optionsOpen} onOpenChange={setOptionsOpen}>
                  <Tooltip content="Publication options">
                    <Popover.Trigger asChild>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Publication options"
                      >
                        <Ellipsis size={18} />
                      </button>
                    </Popover.Trigger>
                  </Tooltip>
                  <Popover.Portal>
                    <Popover.Content
                      className="admin-publication-actions"
                      align="end"
                      aria-label="Publication options"
                    >
                      {!!versionHistory.data?.replacements.length && (
                        <SelectField
                          label="Published versions"
                          value={draft.publishedVersionId}
                          disabled={busy || dirty || invalidFields.size > 0}
                          onChange={(id) => {
                            setOptionsOpen(false);
                            void perform(
                              () => createDraft({ problemVersionId: id, edit: true }),
                              "",
                              "Could not open the version.",
                            );
                          }}
                          options={[
                            {
                              value: draft.publishedVersionId,
                              label: `Version ${content.problem.version}`,
                            },
                            ...versionHistory.data.replacements.map((version) => ({
                              value: version.id,
                              label: `Version ${version.version} · ${version.title}`,
                            })),
                          ]}
                        />
                      )}
                      <button
                        className="button button-secondary"
                        disabled={busy || dirty || invalidFields.size > 0}
                        onClick={() => {
                          setOptionsOpen(false);
                          void perform(
                            () => createDraft({ problemVersionId: draft.publishedVersionId! }),
                            "New version draft created.",
                            "Could not create a version draft. Try again.",
                          );
                        }}
                      >
                        <FilePlus2 size={16} aria-hidden="true" /> Create next version
                      </button>
                      <button
                        className="button button-secondary admin-delete-action"
                        disabled={busy || dirty}
                        onClick={() => {
                          setOptionsOpen(false);
                          void requestDeletion();
                        }}
                      >
                        <Trash2 size={16} aria-hidden="true" /> Delete version
                      </button>
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
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
                  <Save size={16} aria-hidden="true" /> Save draft
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
              <QuestionLanguage.Provider
                value={content.problem.sql ? "postgresql" : previewLanguage}
              >
                <PublicPreview
                  content={content}
                  preferredLanguage={content.problem.sql ? "postgresql" : previewLanguage}
                  theme={theme}
                  colorScheme={preferences.editorSchemes[theme]}
                />
              </QuestionLanguage.Provider>
            </PreviewBoundary>
          ) : (
            <QuestionFields
              key={`${draft.id}:${draft.revision}`}
              content={content}
              previewLanguage={previewLanguage}
              onPreviewLanguageChange={setPreviewLanguage}
              disabled={locked}
              lockSlug={!!(draft.publishedVersionId || draft.editVersionId)}
              invalidCases={[...invalidFields.keys()].some((key) => key.startsWith("cases:"))}
              validationIssues={[...invalidFields.values()].flat()}
              onValidityChange={(label, invalid, issues) => (
                invalid && setDirty(true),
                setInvalidFields((previous) =>
                  updateAuthoringIssues(previous, label, invalid, issues),
                )
              )}
              onChange={(next) => {
                setContent(next);
                setDirty(true);
              }}
            />
          )}
        </section>
      )}
    </main>
  );
}
