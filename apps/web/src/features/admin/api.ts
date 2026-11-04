/** @file api.ts @description Admin authoring uses the same verified transport as judging. @module admin */
import type { QuestionContent, QuestionDraft } from "@quorem/contracts";
import { api, requireData } from "../../api/client";

/** @returns All administrative drafts; backend checks the live server-owned role. */
export async function listDrafts(cursor?: string) {
  const { data, error } = await api().GET("/v1/admin/question-drafts", {
    params: { query: { cursor } },
  });
  return requireData(data, error);
}

/** @returns A fresh mutable draft or a clone of an immutable publication. */
export async function createDraft(
  body:
    | { content: QuestionContent; problemVersionId?: never }
    | { problemVersionId: string; edit?: boolean; content?: never },
) {
  const { data, error } = await api().POST("/v1/admin/question-drafts", { body });
  return requireData(data, error);
}

/** @returns Updated content; a stale revision fails rather than overwriting another admin. */
export async function saveDraft(draft: QuestionDraft, content: QuestionContent) {
  const { data, error } = await api().PUT("/v1/admin/question-drafts/{id}", {
    params: { path: { id: draft.id } },
    body: { revision: draft.revision, content },
  });
  return requireData(data, error);
}

/** @returns The sealed publication ID, committed with its language artifacts and editorial. */
export async function publishDraft(draft: QuestionDraft, visibility: "private" | "global") {
  const { data, error } = await api().POST("/v1/admin/question-drafts/{id}/publish", {
    params: { path: { id: draft.id } },
    body: { revision: draft.revision, visibility },
  });
  return requireData(data, error);
}

/** @returns The protected draft, fetched only when opened. */
export async function getDraft(id: string) {
  const { data, error } = await api().GET("/v1/admin/question-drafts/{id}", {
    params: { path: { id } },
  });
  return requireData(data, error);
}

/** Sends original file text so the API can parse each question losslessly. */
export async function importDraftBatch(items: string[], preview: boolean) {
  const { data, response } = await api().POST("/v1/admin/question-drafts/import-batch", {
    params: { query: preview ? { preview: "1" } : {} },
    body: { items },
  });
  return { data, status: response.status };
}

/** @returns The references affected by deleting a published question. */
export async function fetchDeletionImpact(id: string) {
  const { data, error } = await api().GET("/v1/admin/question-drafts/{id}/deletion-impact", {
    params: { path: { id } },
  });
  return requireData(data, error);
}

export async function deleteQuestionPublication(
  draft: QuestionDraft,
  replacementVersionId?: string | null,
) {
  const { data, error } = await api().DELETE("/v1/admin/question-drafts/{id}/publication", {
    params: { path: { id: draft.id } },
    body: { revision: draft.revision, replacementVersionId },
  });
  return requireData(data, error);
}

export async function listPublications() {
  const { data, error } = await api().GET("/v1/admin/question-publications");
  return requireData(data, error).items;
}
