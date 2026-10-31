/** @file ports.ts @description Transactional question authoring operations. @module problems */
export interface AuthorActor {
  readonly userId: string;
  readonly admin: boolean;
  readonly globalAllowed?: boolean;
}
export interface QuestionAuthoring {
  list(actor: AuthorActor, cursor: string): Promise<string>;
  get(actor: AuthorActor, id: string): Promise<string>;
  create(
    actor: AuthorActor,
    content: string | undefined,
    versionId: string | undefined,
  ): Promise<string>;
  update(actor: AuthorActor, id: string, revision: string, content: string): Promise<string>;
  publish(
    actor: AuthorActor,
    id: string,
    revision: string,
    visibility: "" | "private" | "global",
  ): Promise<string>;
}
