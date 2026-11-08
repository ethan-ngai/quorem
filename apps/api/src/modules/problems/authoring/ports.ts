/** @file ports.ts @description Transactional question authoring operations. @module problems */
import type { CatalogFilter } from "../model.ts";

export type AuthoringFilters = Omit<CatalogFilter, "sort"> & {
  sort: "title" | "difficulty" | "updatedAt";
  source?: string;
  readiness?: string;
};

export interface AuthorActor {
  readonly userId: string;
  readonly admin: boolean;
  /** Recent verification for destructive global changes; never grants an administrator role. */
  readonly globalAllowed?: boolean;
}
export type DraftMutation = { id: string; revision: string };
export type AuthoringBatch =
  | { action: "publish"; items: (DraftMutation & { visibility: "private" | "global" })[] }
  | { action: "delete-drafts"; items: DraftMutation[] }
  | { action: "delete-publications"; items: { id: string }[] };

export interface QuestionAuthoring {
  mutateBatch(actor: AuthorActor, batch: AuthoringBatch): Promise<string>;
  publications(actor: AuthorActor, filters?: AuthoringFilters): Promise<string>;
  list(actor: AuthorActor, filters?: AuthoringFilters): Promise<string>;
  get(actor: AuthorActor, id: string): Promise<string>;
  create(
    actor: AuthorActor,
    content: string | undefined,
    versionId: string | undefined,
  ): Promise<string>;
  importDraft(actor: AuthorActor, content: string, preview: boolean): Promise<string>;
  importDraftBatch(
    actor: AuthorActor,
    contents: readonly string[],
    preview: boolean,
  ): Promise<string>;
  update(actor: AuthorActor, id: string, revision: string, content: string): Promise<string>;
  deleteDraft(actor: AuthorActor, id: string, revision: string): Promise<string>;
  deletionImpact(actor: AuthorActor, id: string): Promise<string>;
  deletePublication(actor: AuthorActor, id: string, revision: string): Promise<string>;
  publish(
    actor: AuthorActor,
    id: string,
    revision: string,
    visibility: "" | "private" | "global",
  ): Promise<string>;
}
