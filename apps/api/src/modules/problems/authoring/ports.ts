/** @file ports.ts @description Transactional question authoring operations. @module problems */
export interface AuthorActor {
  readonly userId: string;
  readonly admin: boolean;
  readonly globalAllowed?: boolean;
}
export interface QuestionAuthoring {
  publications(actor: AuthorActor): Promise<string>;
  list(actor: AuthorActor, cursor: string): Promise<string>;
  get(actor: AuthorActor, id: string): Promise<string>;
  create(
    actor: AuthorActor,
    content: string | undefined,
    versionId: string | undefined,
    edit?: boolean,
  ): Promise<string>;
  importDraft(actor: AuthorActor, content: string, preview: boolean): Promise<string>;
  importDraftBatch(
    actor: AuthorActor,
    contents: readonly string[],
    preview: boolean,
  ): Promise<string>;
  update(actor: AuthorActor, id: string, revision: string, content: string): Promise<string>;
  deletionImpact(actor: AuthorActor, id: string): Promise<string>;
  deletePublication(
    actor: AuthorActor,
    id: string,
    revision: string,
    replacement: string | null | undefined,
  ): Promise<string>;
  publish(
    actor: AuthorActor,
    id: string,
    revision: string,
    visibility: "" | "private" | "global",
  ): Promise<string>;
}
