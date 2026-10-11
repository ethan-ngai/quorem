/** @file api.ts @description Typed browser requests for public problems and solo workspaces. @module editor */
import { createApiClient } from "@quorem/contracts";
import type {
  CustomCase,
  DevelopmentIdentity,
  DraftHistory,
  ProblemVersion,
  SaveDraftResponse,
  Submission,
  SubmissionAdmission,
  Workspace,
} from "@quorem/contracts";

/** Creates a same-origin client so local requests pass through Vite's API proxy. */
const api = (identity: DevelopmentIdentity) =>
  createApiClient({ baseUrl: window.location.origin, identity });

/** Turns typed API error responses into messages suitable for the workspace. */
function requireData<T>(data: T | undefined, error: unknown): T {
  if (data !== undefined) return data;
  const message =
    typeof error === "object" && error !== null && "error" in error
      ? String((error as { error: { message?: string } }).error.message ?? "Request failed")
      : "Request failed";
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
) {
  const { data, error } = await api(identity).POST("/v1/workspaces", {
    body: { problemVersionId, language: "python" },
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

/** Saves one revision without replacing the editor's active buffer. */
export async function saveDraft(
  identity: DevelopmentIdentity,
  workspaceId: string,
  body: { source: string; editorSessionId: string; saveSequence: string },
) {
  const { data, error } = await api(identity).PUT("/v1/workspaces/{id}/draft", {
    params: { path: { id: workspaceId } },
    body,
  });
  return requireData(data as SaveDraftResponse | undefined, error);
}

/** Loads up to the retained server history limit, newest first. */
export async function fetchDraftHistory(identity: DevelopmentIdentity, workspaceId: string) {
  const { data, error } = await api(identity).GET("/v1/workspaces/{id}/draft-history", {
    params: { path: { id: workspaceId }, query: { limit: 100 } },
  });
  return requireData(data as DraftHistory | undefined, error);
}

/** Restores a history revision as a new active server revision. */
export async function restoreDraft(
  identity: DevelopmentIdentity,
  workspaceId: string,
  revision: string,
) {
  const { data, error } = await api(identity).POST("/v1/workspaces/{id}/restore", {
    params: { path: { id: workspaceId } },
    body: { revision },
  });
  return requireData(data as SaveDraftResponse | undefined, error);
}

/** Admits a source snapshot with an idempotency key. */
export async function createSubmission(
  identity: DevelopmentIdentity,
  workspaceId: string,
  kind: "run" | "submit",
  source: string,
  customCases?: CustomCase[],
) {
  const { data, error } = await api(identity).POST("/v1/submissions", {
    params: { header: { "Idempotency-Key": crypto.randomUUID() } },
    body: { workspaceId, kind, source, customCases },
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
