/** @file index.ts @description Public API types and typed HTTP transport. @module contracts */
import createClient from "openapi-fetch";
import type { components, paths } from "./generated";

export type { components, paths, operations } from "./generated";
export type MethodCall = components["schemas"]["MethodCall"];
export type OdysseyLevel = components["schemas"]["OdysseyLevel"];
export type OdysseyProgress = components["schemas"]["OdysseyProgress"];
export type InterviewSnapshot = components["schemas"]["InterviewSnapshot"];
export type InterviewQuestionInput = components["schemas"]["InterviewQuestionInput"];
export type InterviewDocument = components["schemas"]["InterviewDocument"];
export type InterviewUpdate = components["schemas"]["InterviewUpdate"];
export type InterviewUpdates = components["schemas"]["InterviewUpdates"];
export type InterviewPreview = components["schemas"]["InterviewPreview"];
export type InterviewRole = components["schemas"]["InterviewRole"];
export type QuestionContent = components["schemas"]["QuestionContent"];
export type QuestionDraft = components["schemas"]["QuestionDraft"];
export type QuestionDraftSummary = components["schemas"]["QuestionDraftSummary"];
export type QuestionDraftPage = components["schemas"]["QuestionDraftPage"];
export type AuthoringImplementation = components["schemas"]["AuthoringImplementation"];
export type EditorialSolution = components["schemas"]["EditorialSolution"];
export type EditorialComplexity = components["schemas"]["EditorialComplexity"];
export type LanguageImplementation = components["schemas"]["LanguageImplementation"];
export type ProblemVersion = components["schemas"]["ProblemVersion"];
export type Constraint = components["schemas"]["Constraint"];
export type ConstraintTarget = components["schemas"]["ConstraintTarget"];
export type InputPresetConfig = components["schemas"]["InputPresetConfig"];
export type Signature = components["schemas"]["Signature"];
export type Workspace = components["schemas"]["Workspace"];
export type EditorPreferences = components["schemas"]["EditorPreferences"];
export type CustomCase = components["schemas"]["CustomCase"];
export type Submission = components["schemas"]["Submission"];
export type SubmissionAdmission = components["schemas"]["SubmissionAdmission"];
export type CreateSubmissionRequest = components["schemas"]["CreateSubmissionRequest"];
export type HiddenCaseResult = components["schemas"]["HiddenCaseResult"];
export type PublicCaseResult = components["schemas"]["PublicCaseResult"];
export type Diagnostic = components["schemas"]["Diagnostic"];
export type MatchSnapshot = components["schemas"]["MatchSnapshot"];
export type MatchInvite = components["schemas"]["MatchInvite"];
export type CreateMatchRequest = components["schemas"]["CreateMatchRequest"];
export type MatchMode = components["schemas"]["MatchMode"];
export type MatchRules = components["schemas"]["MatchRules"];
export type MatchRuleKind = components["schemas"]["MatchRuleKind"];
export type MatchRuleAction = components["schemas"]["MatchRuleAction"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];
export type EventEnvelope = components["schemas"]["EventEnvelope"];
export type DevelopmentIdentity = "alice" | "bob" | "charlie" | "dana";

/** Stable local subjects; production identity supplies its own internal UUID. */
export const developmentUserIds: Record<DevelopmentIdentity, string> = {
  alice: "00000000-0000-4000-8000-000000000001",
  bob: "00000000-0000-4000-8000-000000000002",
  charlie: "00000000-0000-4000-8000-000000000003",
  dana: "00000000-0000-4000-8000-000000000004",
};

export function participantUserId(identity: string): string {
  return developmentUserIds[identity as DevelopmentIdentity] ?? identity;
}

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
