/** @file access.ts @description Durable workspace membership shared by document and result readers. @module workspace */
import { sql } from "drizzle-orm";
/** Caller joins the workspace as w; team membership survives language changes. */
export function workspaceAccess(owner: string) {
  return sql`(w.owner_id=${owner} OR (w.kind='match' AND EXISTS (SELECT 1 FROM match_participants teammate WHERE teammate.match_id=w.match_id AND teammate.owner_id=${owner} AND teammate.team IS NOT NULL AND teammate.team=w.team)))`;
}
