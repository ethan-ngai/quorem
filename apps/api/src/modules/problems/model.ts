/** @file model.ts @description Catalog query values. @module problems */
export interface CatalogFilter {
  query: string;
  difficulty: string;
  topic: string;
  company: string;
  sort: "title" | "difficulty";
  order: "asc" | "desc";
  library: "" | "global" | "private";
  type: "" | "classic" | "odyssey";
  sql: "" | "true" | "false";
  page: number;
  limit: number;
  cursor?: string;
}
export interface ProblemActor {
  readonly userId: string;
}
export interface CandidateCriteria {
  readonly selectedVersionId?: string;
  readonly difficulty: string;
  readonly topic: string;
  readonly company: string;
  readonly type: "" | "classic" | "odyssey";
  readonly sql: "true" | "false";
}
export interface Candidate {
  readonly id: string;
  readonly sql: boolean;
}
