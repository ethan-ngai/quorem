/** @file model.ts @description Immutable workspace and Odyssey contracts. @module workspace */
import type { Principal } from "../identity/model.ts";
export type WorkspaceLanguage = "python" | "java" | "typescript" | "ocaml" | "postgresql";
export interface Workspace {
  id: string;
  kind: "solo" | "match";
  problemVersionId: string;
  language: WorkspaceLanguage;
  matchId?: string;
}
export interface WorkspaceRepository {
  create(
    principal: Principal,
    problemVersionId: string,
    language: WorkspaceLanguage,
  ): Promise<Workspace>;
  read(principal: Principal, id: string): Promise<Workspace>;
  odyssey(principal: Principal, id: string): Promise<ReadableStream<Uint8Array>>;
  reset(principal: Principal, id: string): Promise<string>;
}
