/** @file model.ts @description Catalog query values. @module problems */
import type { FilterMatch } from "@quorem/contracts";

export interface CatalogFilter {
  query: string;
  difficulty: string;
  topic: string;
  topicMatch?: FilterMatch;
  company: string;
  companyMatch?: FilterMatch;
  groupBy?: "topic";
  topicGroup?: string | null;
  sort: "title" | "difficulty" | "recommended";
  order: "asc" | "desc";
  library: "" | "global" | "private";
  type: "" | "classic" | "odyssey";
  sql: "" | "true" | "false";
  page: number;
  limit: number;
}
export interface ProblemActor {
  readonly userId: string;
  readonly guestScope?: import("../identity/model.ts").GuestScope;
}
export interface CandidateCriteria {
  readonly selectedPublicationId?: string;
  readonly difficulty: string;
  readonly topic: string;
  readonly topicMatch?: FilterMatch;
  readonly company: string;
  readonly companyMatch?: FilterMatch;
  readonly type: "" | "classic" | "odyssey";
  readonly sql: "true" | "false";
}
export interface Candidate {
  readonly id: string;
  readonly sql: boolean;
}
