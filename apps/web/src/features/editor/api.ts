import { api, requireData } from "../../api/client";
/** @file api.ts @description Typed browser requests for public problems and solo workspaces. @module editor */
import { randomUUID } from "../../randomUUID";
import type {
  CustomCase,
  DevelopmentIdentity,
  ProblemVersion,
  Submission,
  SubmissionAdmission,
  Workspace,
} from "@quorem/contracts";

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
  language: "python" | "java" | "typescript" | "ocaml" | "postgresql" = "python",
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
  idempotencyKey: string = randomUUID(),
  level?: number,
) {
  const { data, error } = await api(identity).POST("/v1/submissions", {
    params: { header: { "Idempotency-Key": idempotencyKey } },
    body: { workspaceId, kind, source, customCases, ...(level !== undefined ? { level } : {}) },
  });
  return requireData(data as SubmissionAdmission | undefined, error);
}

/** Requests cancellation where the workspace contract allows it. */
export async function cancelSubmission(identity: DevelopmentIdentity, id: string) {
  const { data, error } = await api(identity).POST("/v1/submissions/{id}/cancel", {
    params: {
      path: { id },
      header: { "Idempotency-Key": randomUUID() },
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
  language: "python" | "java" | "typescript" | "ocaml" | "postgresql",
) {
  const { data, error } = await api(identity).POST("/v1/matches/{id}/workspace-language", {
    params: { path: { id: matchId }, header: { "Idempotency-Key": randomUUID() } },
    body: { language },
  });
  return requireData(data as Workspace | undefined, error);
}
