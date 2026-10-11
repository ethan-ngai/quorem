/** @file executionGuard.ts @description Admission guard for the exact loaded owner document. @module editor */
import type {
  DevelopmentIdentity,
  MatchSnapshot,
  ProblemVersion,
  Workspace,
} from "@quorem/contracts";

type ExecutionContext = {
  identity: DevelopmentIdentity;
  contextKey?: string;
  problem?: Pick<ProblemVersion, "id" | "slug">;
  workspace?: Pick<Workspace, "id" | "kind" | "problemVersionId" | "matchId">;
  slug: string;
  match?: Pick<MatchSnapshot, "id" | "state" | "problemVersionId">;
  matchWorkspaceId?: string;
  loaded: boolean;
};

/** @returns Whether toolbar and keyboard commands target the exact loaded workspace. */
export function canExecuteDocument({
  identity,
  contextKey,
  problem,
  workspace,
  slug,
  match,
  matchWorkspaceId,
  loaded,
}: ExecutionContext) {
  if (
    !loaded ||
    !problem ||
    !workspace ||
    contextKey !== `${identity}:${workspace.id}:${problem.id}` ||
    workspace.problemVersionId !== problem.id
  )
    return false;
  if (!match) return workspace.kind === "solo" && problem.slug === slug;
  return (
    match.state === "active" &&
    workspace.kind === "match" &&
    workspace.id === matchWorkspaceId &&
    workspace.matchId === match.id &&
    problem.id === match.problemVersionId
  );
}
