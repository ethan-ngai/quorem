/** @file repository.ts @description PostgreSQL advisory cursors and socket leases. @module interviews */
import { sql } from "drizzle-orm";
import {
  acquireSocketLease,
  renewSocketLease,
  releaseSocketLease,
} from "../../events/socket/leases.ts";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type {
  InterviewPresence,
  Presence,
  PresenceInput,
} from "../../../../modules/interviews/presence/model.ts";
import { capabilitiesInTransaction } from "../../access/repository.ts";
import { readInterviewAccess } from "../lifecycle/access.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const opts = { statementTimeoutMs: 3000, lockTimeoutMs: 1000 };
const invalid = () => new ApplicationError("invalid_input", "Invalid editor presence", 400);
const quota = () => new ApplicationError("quota_exceeded", "Too many editor windows", 429);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Lock only authority rows: document writes never wait on socket leases. */
async function leaseAccess(
  tx: Transaction,
  actor: import("../../../../modules/identity/model.ts").Principal,
  id: string,
) {
  if (!uuid.test(id)) throw new ApplicationError("not_found", "Interview unavailable", 404);
  await tx.execute(
    sql`SELECT m.user_id FROM interview_members m JOIN interviews i ON i.id=m.session_id JOIN users u ON u.id=m.user_id JOIN users h ON h.id=i.host_id WHERE m.session_id=${id}::uuid AND m.user_id=${actor.userId} FOR SHARE OF m,u,h`,
  );
  await tx.execute(
    sql`SELECT g.id FROM entitlement_grants g JOIN interviews i ON i.host_id=g.user_id WHERE i.id=${id}::uuid AND g.feature IN ('internal','interviews.host') AND g.revoked_at IS NULL AND g.valid_from<=clock_timestamp() AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp()) FOR SHARE OF g`,
  );
  return readInterviewAccess(tx, actor, id, capabilitiesInTransaction, { active: true });
}
const activeInterview = (id: string, owner: string) =>
  sql`EXISTS(SELECT 1 FROM interviews i JOIN interview_members m ON m.session_id=i.id AND m.user_id=${owner} AND m.removed_at IS NULL JOIN users u ON u.id=m.user_id AND NOT u.disabled JOIN users h ON h.id=i.host_id AND NOT h.disabled WHERE i.id=${id}::uuid AND i.state='active' AND i.deleted_at IS NULL AND EXISTS(SELECT 1 FROM entitlement_grants g WHERE g.user_id=i.host_id AND g.feature IN ('internal','interviews.host') AND g.revoked_at IS NULL AND g.valid_from<=clock_timestamp() AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())))`;
async function peers(tx: Transaction, id: string): Promise<Presence[]> {
  const rows = (
    await tx.execute<{
      clientID: string;
      userId: string;
      name: string;
      color: number;
      epoch: string;
      version: string;
      anchor: number;
      head: number;
    }>(
      sql`SELECT p.client_id AS "clientID",p.user_id AS "userId",u.display_name AS name,u.profile_color AS color,p.epoch::text AS epoch,p.version::text AS version,p.anchor,p.head FROM interview_presence p JOIN interview_members m ON m.session_id=p.session_id AND m.user_id=p.user_id AND m.removed_at IS NULL JOIN users u ON u.id=p.user_id AND NOT u.disabled JOIN interviews i ON i.id=p.session_id AND i.document_epoch=p.epoch WHERE p.session_id=${id}::uuid AND p.updated_at>clock_timestamp()-interval '20 seconds' ORDER BY p.user_id,p.client_id LIMIT 48`,
    )
  ).rows;
  return rows.map((r) => ({
    clientID: r.clientID,
    userId: r.userId,
    name: r.name,
    ...(r.color ? { color: r.color } : {}),
    epoch: r.epoch,
    version: Number(r.version),
    anchor: r.anchor,
    head: r.head,
  }));
}
function valid(p: PresenceInput) {
  return (
    p &&
    typeof p.clientID === "string" &&
    !!p.clientID.trim() &&
    new TextEncoder().encode(p.clientID).length <= 128 &&
    typeof p.epoch === "string" &&
    [p.version, p.anchor, p.head].every(Number.isSafeInteger) &&
    p.version >= 0 &&
    p.anchor >= 0 &&
    p.head >= 0
  );
}
export function interviewPresence(run: Run): InterviewPresence {
  const transaction = <T>(fn: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction(opts, fn));
  return {
    peers: (actor, id) =>
      transaction(async (tx) => {
        await readInterviewAccess(tx, actor, id, capabilitiesInTransaction);
        return peers(tx, id);
      }),
    update: (actor, id, input) =>
      transaction(async (tx) => {
        if (!valid(input)) throw invalid();
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`interview-presence:${id}:${actor.userId}`},0))`,
        );
        await readInterviewAccess(tx, actor, id, capabilitiesInTransaction, { active: true });
        const current = (
          await tx.execute<{ source: string; epoch: string; version: string }>(
            sql`SELECT source,document_epoch::text AS epoch,document_version::text AS version FROM interviews WHERE id=${id}::uuid`,
          )
        ).rows[0];
        if (input.anchor > current.source.length || input.head > current.source.length)
          throw invalid();
        if (input.epoch !== current.epoch || input.version !== Number(current.version))
          throw new ApplicationError("stale_version", "Synchronize before sending presence", 409);
        await tx.execute(
          sql`DELETE FROM interview_presence WHERE session_id=${id}::uuid AND user_id=${actor.userId} AND updated_at<=clock_timestamp()-interval '20 seconds'`,
        );
        const n = (
          await tx.execute<{ count: string }>(
            sql`SELECT count(*)::text AS count FROM interview_presence WHERE session_id=${id}::uuid AND user_id=${actor.userId} AND client_id<>${input.clientID}`,
          )
        ).rows[0];
        if (Number(n.count) >= 4) throw quota();
        const rows = await tx.execute(
          sql`INSERT INTO interview_presence(session_id,user_id,client_id,epoch,version,anchor,head) SELECT i.id,${actor.userId},${input.clientID},i.document_epoch,i.document_version,${input.anchor},${input.head} FROM interviews i JOIN interview_members m ON m.session_id=i.id AND m.user_id=${actor.userId} AND m.removed_at IS NULL JOIN users u ON u.id=m.user_id AND NOT u.disabled JOIN users h ON h.id=i.host_id AND NOT h.disabled WHERE i.id=${id}::uuid AND i.deleted_at IS NULL AND i.state='active' AND i.document_epoch=${input.epoch}::uuid AND i.document_version=${input.version} AND EXISTS(SELECT 1 FROM entitlement_grants g WHERE g.user_id=i.host_id AND g.feature IN ('internal','interviews.host') AND g.revoked_at IS NULL AND g.valid_from<=clock_timestamp() AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())) ON CONFLICT(session_id,user_id,client_id) DO UPDATE SET epoch=EXCLUDED.epoch,version=EXCLUDED.version,anchor=EXCLUDED.anchor,head=EXCLUDED.head,updated_at=clock_timestamp() RETURNING client_id`,
        );
        if (!rows.rows.length)
          throw new ApplicationError("stale_version", "Synchronize before sending presence", 409);
        return peers(tx, id);
      }),
    acquire: (actor, id) =>
      transaction(async (tx) => {
        await leaseAccess(tx, actor, id);
        return acquireSocketLease(
          tx,
          `/interviews/${id}`,
          actor.userId,
          () => leaseAccess(tx, actor, id),
          activeInterview(id, actor.userId),
        );
      }),
    renew: (actor, id, lease) =>
      transaction((tx) =>
        renewSocketLease(
          tx,
          `/interviews/${id}`,
          actor.userId,
          lease,
          () => leaseAccess(tx, actor, id),
          activeInterview(id, actor.userId),
        ),
      ),
    release: (actor, id, lease) =>
      transaction((tx) => releaseSocketLease(tx, `/interviews/${id}`, actor.userId, lease)),
  };
}

/** Release only the exact previously acquired window lease, including after revocation. */
export async function releaseInterviewLease(
  run: Run,
  id: string,
  owner: string,
  lease: string,
): Promise<void> {
  if (!uuid.test(id)) return;
  await run((scope) =>
    scope.transaction(opts, (tx) => releaseSocketLease(tx, `/interviews/${id}`, owner, lease)),
  );
}
