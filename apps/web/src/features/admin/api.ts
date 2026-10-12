/** @file api.ts @description Admin authoring uses the same verified transport as judging. @module admin */
import type { QuestionContent, QuestionDraft, DevelopmentIdentity } from "@quorem/contracts";
import { api, requireData } from "../editor/api";

import { readPreference } from "../editor/editorSettings";
const client = () => api(readPreference<DevelopmentIdentity>("quorem.dev-identity.v1", "alice"));

/** @returns All administrative drafts; backend checks the live server-owned role. */
export async function listDrafts(cursor?: string) {
  const { data, error } = await client().GET("/v1/admin/question-drafts", {
    params: { query: { cursor } },
  });
  return requireData(data, error);
}

/** @returns A fresh mutable draft or a clone of an immutable publication. */
export async function createDraft(
  body:
    | { content: QuestionContent; problemVersionId?: never }
    | { problemVersionId: string; content?: never },
) {
  const { data, error } = await client().POST("/v1/admin/question-drafts", { body });
  return requireData(data, error);
}

/** @returns Updated content; a stale revision fails rather than overwriting another admin. */
export async function saveDraft(draft: QuestionDraft, content: QuestionContent) {
  const { data, error } = await client().PUT("/v1/admin/question-drafts/{id}", {
    params: { path: { id: draft.id } },
    body: { revision: draft.revision, content },
  });
  return requireData(data, error);
}

/** @returns The sealed publication ID, committed with its language artifacts and editorial. */
export async function publishDraft(draft: QuestionDraft) {
  const { data, error } = await client().POST("/v1/admin/question-drafts/{id}/publish", {
    params: { path: { id: draft.id } },
    body: { revision: draft.revision },
  });
  return requireData(data, error);
}

/** @returns The protected draft, fetched only when opened. */
export async function getDraft(id: string) {
  const { data, error } = await client().GET("/v1/admin/question-drafts/{id}", {
    params: { path: { id } },
  });
  return requireData(data, error);
}
