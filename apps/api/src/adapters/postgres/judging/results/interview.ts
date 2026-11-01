/** @file interview.ts @description Authorized per-case interview result projection. @module judging */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
const missing = () => new ApplicationError("not_found", "Execution unavailable", 404);
type Access = { role: string; epoch: string; userId: string };
export async function interviewAccess(
  tx: Transaction,
  who: Principal,
  id: string,
): Promise<Access> {
  if (who.kind === "guest" && (who.scope.kind !== "interview" || who.scope.interviewId !== id))
    throw missing();
  const row = (
    await tx.execute<{ role: string; epoch: string }>(
      sql`SELECT m.role,i.question_epoch::text AS epoch FROM interviews i JOIN interview_members m ON m.session_id=i.id AND m.user_id=${who.userId} AND m.removed_at IS NULL JOIN users host ON host.id=i.host_id AND NOT host.disabled WHERE i.id=${id}::uuid AND i.deleted_at IS NULL FOR SHARE OF i,m,host`,
    )
  ).rows[0];
  if (!row) throw missing();
  return { ...row, userId: who.userId };
}
