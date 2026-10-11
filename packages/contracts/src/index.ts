/** @file index.ts @description Public API types and typed HTTP transport. @module contracts */
import createClient from "openapi-fetch";
import type { components, paths } from "./generated";

export type { components, paths, operations } from "./generated";
export type ProblemVersion = components["schemas"]["ProblemVersion"];
export type Constraint = components["schemas"]["Constraint"];
export type ConstraintTarget = components["schemas"]["ConstraintTarget"];
export type InputPresetConfig = components["schemas"]["InputPresetConfig"];
export type Signature = components["schemas"]["Signature"];
export type Workspace = components["schemas"]["Workspace"];
export type Draft = components["schemas"]["Draft"];
export type DraftHistory = components["schemas"]["DraftHistory"];
export type EditorPreferences = components["schemas"]["EditorPreferences"];
export type CustomCase = components["schemas"]["CustomCase"];
export type Submission = components["schemas"]["Submission"];
export type SubmissionAdmission = components["schemas"]["SubmissionAdmission"];
export type CreateSubmissionRequest = components["schemas"]["CreateSubmissionRequest"];
export type SaveDraftRequest = components["schemas"]["SaveDraftRequest"];
export type SaveDraftResponse = components["schemas"]["SaveDraftResponse"];
export type PublicCaseResult = components["schemas"]["PublicCaseResult"];
export type Diagnostic = components["schemas"]["Diagnostic"];
export type MatchSnapshot = components["schemas"]["MatchSnapshot"];
export type MatchInvite = components["schemas"]["MatchInvite"];
export type CreateMatchRequest = components["schemas"]["CreateMatchRequest"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];
export type EventEnvelope = components["schemas"]["EventEnvelope"];
export type DevelopmentIdentity = "alice" | "bob";

/** Stable local subjects; production identity supplies its own internal UUID. */
export const developmentUserIds: Record<DevelopmentIdentity, string> = {
  alice: "00000000-0000-4000-8000-000000000001",
  bob: "00000000-0000-4000-8000-000000000002",
};

/** @returns Typed client; development identity is explicit. */
export function createApiClient(
  options: {
    baseUrl?: string;
    identity?: DevelopmentIdentity;
    fetch?: typeof globalThis.fetch;
  } = {},
) {
  return createClient<paths>({
    baseUrl: options.baseUrl ?? "http://localhost:8080",
    fetch: options.fetch,
    headers: options.identity ? { "X-Dev-User": options.identity } : undefined,
  });
}
