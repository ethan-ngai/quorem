/** @file model.ts @description Completed match review port. @module matches */
import type { Workspace, WorkspaceLanguage } from "../../workspace/model.ts";
import type { Principal } from "../../identity/model.ts";

export interface MatchReview {
  createWorkspace(
    principal: Principal,
    matchId: string,
    participantUserId: string,
    language: WorkspaceLanguage,
  ): Promise<Workspace>;
  read(principal: Principal, matchId: string): Promise<string>;
}
