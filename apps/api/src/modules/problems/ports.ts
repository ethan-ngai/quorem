/** @file ports.ts @description Authorized catalog read ports. @module problems */
import type { Candidate, CandidateCriteria, CatalogFilter, ProblemActor } from "./model.ts";
export type RecommendationAction = "view" | "dismiss";
export interface ProblemQueries {
  catalog(actor: ProblemActor | undefined, filter: CatalogFilter): Promise<string>;
  bySlug(actor: ProblemActor | undefined, slug: string): Promise<string | null>;
  byPublication(actor: ProblemActor | undefined, id: string): Promise<string | null>;
  editorials(actor: ProblemActor | undefined, id: string, complexityOnly: boolean): Promise<string>;
  recommendationFeedback(
    owner: string,
    ids: readonly string[],
    action: RecommendationAction,
  ): Promise<void>;
  candidates(actor: ProblemActor, criteria: CandidateCriteria): Promise<readonly Candidate[]>;
}
