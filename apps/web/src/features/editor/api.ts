/** @file api.ts @description Typed browser requests for public problems and solo workspaces. @module editor */
import { UserFacingError } from "../../ui/errors";
import { authenticatedFetch } from "../auth/session";
import { createApiClient } from "@quorem/contracts";
import type {
  CustomCase,
  DevelopmentIdentity,
  ProblemVersion,
  Submission,
  SubmissionAdmission,
  Workspace,
} from "@quorem/contracts";

/** Creates a same-origin client so local requests pass through Vite's API proxy. */
export const api = (identity: DevelopmentIdentity = "anonymous" as DevelopmentIdentity) =>
  createApiClient({
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? window.location.origin,
    identity,
    fetch: authenticatedFetch,
  });

/** Turns typed API error responses into messages suitable for the workspace. */
export function requireData<T>(data: T | undefined, error: unknown): T {
  if (data !== undefined) return data;
  const message =
    typeof error === "object" && error !== null && "error" in error
      ? String((error as { error: { message?: string } }).error.message ?? "Request failed")
      : "Request failed";
  const code =
    error && typeof error === "object" && "error" in error
      ? (error.error as { code?: string })?.code
      : undefined;
  const safeMessages: Record<string, string> = {
    step_up_required: "Sign in with a verified passkey again before publishing.",
    entitlement_required: "Guest hosting requires an eligible plan or internal access.",
    quota_exceeded: "Execution allowance reached. Please try again later.",
    rate_limited: "Too many requests or another guest run is active. Try again shortly.",
    room_full: "This lobby is full.",
  };
  if (code && safeMessages[code]) throw new UserFacingError(safeMessages[code]);
  throw new Error(message);
}

/** Loads the latest public immutable problem version for a slug. */
export async function fetchProblem(identity: DevelopmentIdentity, slug: string) {
  const { data, error } = await api(identity).GET("/v1/problems/{slug}", {
    params: { path: { slug } },
  });
  return requireData(data as ProblemVersion | undefined, error);
}

/** Creates or reuses the owner's solo workspace for a problem version. */
export async function createWorkspace(
  identity: DevelopmentIdentity,
  problemVersionId: string,
  language: "python" | "java" | "typescript" | "ocaml" = "python",
) {
  const { data, error } = await api(identity).POST("/v1/workspaces", {
    body: { problemVersionId, language },
  });
  return requireData(data as Workspace | undefined, error);
}

/** Fetches an owner-scoped workspace snapshot. */
export async function fetchWorkspace(identity: DevelopmentIdentity, id: string) {
  const { data, error } = await api(identity).GET("/v1/workspaces/{id}", {
    params: { path: { id } },
  });
  return requireData(data as Workspace | undefined, error);
}

/** Admits a source snapshot with an idempotency key. */
export async function createSubmission(
  identity: DevelopmentIdentity,
  workspaceId: string,
  kind: "run" | "submit",
  source: string,
  customCases?: CustomCase[],
  idempotencyKey: string = crypto.randomUUID(),
  level?: number,
) {
  const { data, error } = await api(identity).POST("/v1/submissions", {
    params: { header: { "Idempotency-Key": idempotencyKey } },
    body: { workspaceId, kind, source, customCases, ...(level !== undefined ? { level } : {}) },
  });
  return requireData(data as SubmissionAdmission | undefined, error);
}

/** Reads the safe owner-facing state of one judge job. */
export async function fetchSubmission(identity: DevelopmentIdentity, id: string) {
  const { data, error } = await api(identity).GET("/v1/submissions/{id}", {
    params: { path: { id } },
  });
  return requireData(data as Submission | undefined, error);
}

/** Requests cancellation where the workspace contract allows it. */
export async function cancelSubmission(identity: DevelopmentIdentity, id: string) {
  const { data, error } = await api(identity).POST("/v1/submissions/{id}/cancel", {
    params: {
      path: { id },
      header: { "Idempotency-Key": crypto.randomUUID() },
    },
  });
  return requireData(data as Submission | undefined, error);
}

/** Loads an authorized immutable version, including a started match problem. */
export async function fetchProblemVersion(identity: DevelopmentIdentity, id: string) {
  const { data, error } = await api(identity).GET("/v1/problem-versions/{id}", {
    params: { path: { id } },
  });
  return requireData(data as ProblemVersion | undefined, error);
}

/** Switches the active participant's workspace without admitting stale-language source. */
export async function switchMatchLanguage(
  identity: DevelopmentIdentity,
  matchId: string,
  language: "python" | "java" | "typescript" | "ocaml",
) {
  const { data, error } = await api(identity).POST("/v1/matches/{id}/workspace-language", {
    params: { path: { id: matchId }, header: { "Idempotency-Key": crypto.randomUUID() } },
    body: { language },
  });
  return requireData(data as Workspace | undefined, error);
}
