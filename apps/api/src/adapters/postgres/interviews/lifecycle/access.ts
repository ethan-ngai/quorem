/** @file access.ts @description Transaction-bound interview membership authority. @module interviews */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import type { InterviewRole } from "../../../../modules/interviews/lifecycle/model.ts";
import { requireInterviewer } from "../../../../modules/interviews/lifecycle/policy.ts";
import { lookupGuestInTransaction } from "../../identity/guest.ts";
import type { Capabilities } from "../../../../modules/access/model.ts";
export type CapabilityLookup = (tx: Transaction, userId: string) => Promise<Capabilities>;
export interface InterviewAccess {
  id: string;
  host: string;
  state: string;
  role: InterviewRole;
  version: string;
  questionEpoch: string;
  documentEpoch: string;
  admissionLocked: boolean;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function unavailable(): ApplicationError {
  return new ApplicationError("not_found", "Interview unavailable", 404);
}
/** The interview lock serializes membership, join, close and question changes. */
async function interviewAccess(
  tx: Transaction,
  actor: Principal,
  id: string,
  capabilities: CapabilityLookup,
  opts: { manage?: boolean; active?: boolean },
  lock: boolean,
): Promise<InterviewAccess> {
  if (!uuid.test(id)) throw unavailable();
  const row = (
    await tx.execute<InterviewAccess & { hostDisabled: boolean } & Record<string, unknown>>(
      sql`SELECT i.id::text,i.host_id AS host,i.state,m.role,i.version::text,i.question_epoch::text AS "questionEpoch",i.document_epoch::text AS "documentEpoch",i.admission_locked AS "admissionLocked",h.disabled AS "hostDisabled" FROM interviews i JOIN interview_members m ON m.session_id=i.id AND m.user_id=${actor.userId} AND m.removed_at IS NULL JOIN users u ON u.id=m.user_id AND NOT u.disabled JOIN users h ON h.id=i.host_id WHERE i.id=${id}::uuid AND i.deleted_at IS NULL ${lock ? sql`FOR NO KEY UPDATE OF i` : sql``}`,
    )
  ).rows[0];
  if (!row) throw unavailable();
  if (row.hostDisabled) throw new ApplicationError("forbidden", "Interview unavailable", 403);
  if (actor.kind === "guest") {
    if (actor.scope.kind !== "interview" || actor.scope.interviewId !== id) throw unavailable();
    const current = await lookupGuestInTransaction(tx, "interview", actor.sessionId);
    if (
      !current ||
      current.userId !== actor.userId ||
      current.scope.kind !== "interview" ||
      current.scope.interviewId !== id
    )
      throw unavailable();
  }
  if (opts.manage) requireInterviewer(row.role);
  if (opts.active) {
    if (row.state !== "active")
      throw new ApplicationError("invalid_transition", "Interview is closed", 409);
    if (!(await capabilities(tx, row.host)).interviews)
      throw new ApplicationError("entitlement_required", "Interview access is disabled", 403);
  }
  return row;
}

/** Serialize room mutations with membership and question transitions. */
export function lockInterview(
  tx: Transaction,
  actor: Principal,
  id: string,
  capabilities: CapabilityLookup,
  opts: { manage?: boolean; active?: boolean } = {},
): Promise<InterviewAccess> {
  return interviewAccess(tx, actor, id, capabilities, opts, true);
}
/** Observe current authority without blocking document writes. */
export function readInterviewAccess(
  tx: Transaction,
  actor: Principal,
  id: string,
  capabilities: CapabilityLookup,
  opts: { manage?: boolean; active?: boolean } = {},
): Promise<InterviewAccess> {
  return interviewAccess(tx, actor, id, capabilities, opts, false);
}
