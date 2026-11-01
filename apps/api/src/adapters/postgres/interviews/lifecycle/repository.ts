/** @file repository.ts @description Atomic interview membership and lifecycle. @module interviews */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import {
  guestTokenHash,
  newGuestToken,
  validGuestToken,
} from "../../../../modules/identity/guest/credentials.ts";
import type {
  InterviewCreate,
  InterviewLifecycle,
  InterviewRole,
} from "../../../../modules/interviews/lifecycle/model.ts";
import { guestName, validTitle } from "../../../../modules/interviews/lifecycle/policy.ts";
import { lockInterview, unavailable } from "./access.ts";
import { capabilitiesInTransaction } from "../../access/repository.ts";
import { operationFingerprint, priorOperation, saveOperation } from "./operations.ts";
import { savePublicExamples, savePrivateCases } from "../question/public-examples.ts";
import { writePublishedInterviewQuestion } from "../question/prepare.ts";
import {
  copySnapshotExamples,
  savePublishedInterviewSidecars,
} from "../question/published-sidecars.ts";
import { createActiveRunnerFixture } from "../runner-inputs/active.ts";
type Run = <T>(action: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
export interface PreparedQuestion {
  safe: string;
  lossless: Uint8Array | null;
  source: string;
  language: string;
  fingerprint: string;
  versionId?: string;
  published?: boolean;
  persist?(tx: Transaction): Promise<void>;
}
export interface Dependencies {
  question(tx: Transaction, actor: Principal, command: InterviewCreate): Promise<PreparedQuestion>;
  snapshot(actor: Principal, id: string): Promise<ReadableStream<Uint8Array>>;
}
const opts = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
const denied = () => new ApplicationError("not_found", "Invitation unavailable", 404);
export function interviewLifecycle(run: Run, deps: Dependencies): InterviewLifecycle {
  const transact = <T>(f: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction(opts, f));
  const mutate = async (
    actor: Principal,
    id: string,
    key: string,
    action: "member" | "remove" | "close" | "admission",
    body: null | boolean | string | readonly string[],
    apply: (tx: Transaction, host: string) => Promise<void>,
  ) =>
    transact(async (tx) => {
      const hash = await operationFingerprint(`${id}:${action}`, body);
      const prior = await priorOperation(tx, actor.userId, key, hash);
      const access = await lockInterview(tx, actor, id, capabilitiesInTransaction, {
        manage: true,
      });
      if (prior) return JSON.stringify({ id });
      if (action === "close") {
        if (access.state !== "active")
          throw new ApplicationError("invalid_transition", "Interview is closed", 409);
      } else
        await lockInterview(tx, actor, id, capabilitiesInTransaction, {
          manage: true,
          active: true,
        });
      await apply(tx, access.host);
      await tx.execute(
        sql`UPDATE interviews SET version=version+1,updated_at=clock_timestamp() WHERE id=${id}::uuid`,
      );
      await saveOperation(tx, actor.userId, key, hash, id);
      return JSON.stringify({ id });
    });
  return {
    async create(actor, key, command) {
      if (actor.kind === "guest")
        throw new ApplicationError("entitlement_required", "Interview hosting is unavailable", 403);
      const title = validTitle(command.title);
      return transact(async (tx) => {
        const host = (
          await tx.execute(
            sql`SELECT id FROM users WHERE id=${actor.userId} AND kind='account' AND NOT disabled FOR UPDATE`,
          )
        ).rows[0];
        if (!host)
          throw new ApplicationError(
            "entitlement_required",
            "Interview hosting is unavailable",
            403,
          );
        const caps = await capabilitiesInTransaction(tx, actor.userId);
        if (!caps.interviews)
          throw new ApplicationError(
            "entitlement_required",
            "Interview hosting is unavailable",
            403,
          );
        const prepared = await deps.question(tx, actor, { ...command, title });
        const prior = await priorOperation(tx, actor.userId, key, prepared.fingerprint);
        if (prior) {
          await lockInterview(tx, actor, prior, capabilitiesInTransaction);
          return JSON.stringify({ id: prior });
        }
        const count = (
          await tx.execute<{ count: string }>(
            sql`SELECT count(*)::text AS count FROM interviews WHERE host_id=${actor.userId} AND state='active'`,
          )
        ).rows[0];
        if (Number(count.count) >= caps.interviewConcurrency)
          throw new ApplicationError(
            "quota_exceeded",
            "End an interview before creating another",
            429,
          );
        if (prepared.persist) await prepared.persist(tx);
        const id = crypto.randomUUID(),
          candidate = newGuestToken(),
          interviewer = newGuestToken(),
          candidateHash = await guestTokenHash(candidate),
          interviewerHash = await guestTokenHash(interviewer),
          questionEpoch = crypto.randomUUID();
        const policy = (command.monitoring ?? {}) as Record<string, unknown>;
        const monitoring = JSON.stringify(
          Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== null)),
        );
        await tx.execute(
          sql`INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,invite_hash,invite_token,question_epoch,interviewer_invite_hash,interviewer_invite_token,monitoring,lossless_question) VALUES(${id}::uuid,${actor.userId},${title},${prepared.safe}::jsonb,${prepared.language},${prepared.source},${crypto.randomUUID()}::uuid,${candidateHash},${candidate},${questionEpoch}::uuid,${interviewerHash},${interviewer},${monitoring}::jsonb,${prepared.lossless})`,
        );
        if (prepared.published && prepared.versionId) {
          await writePublishedInterviewQuestion(
            tx,
            id,
            prepared.versionId,
            prepared.language,
            (command.question as Record<string, unknown>).hints,
          );
          await savePublishedInterviewSidecars(tx, id, questionEpoch, prepared.versionId);
        } else {
          const rawFixture = prepared.lossless
            ? new TextDecoder("utf-8", { fatal: true }).decode(prepared.lossless)
            : prepared.safe;
          await savePublicExamples(tx, id, questionEpoch, rawFixture);
          await savePrivateCases(tx, id, questionEpoch, rawFixture);
          await tx.execute(sql`UPDATE interviews SET lossless_question=NULL WHERE id=${id}::uuid`);
        }
        if (!prepared.versionId) throw new Error("Indexed question version required");
        const fixtureId = await createActiveRunnerFixture(
          tx,
          id,
          questionEpoch,
          prepared.versionId,
        );
        await copySnapshotExamples(tx, id, questionEpoch, fixtureId);
        await tx.execute(
          sql`INSERT INTO interview_members(session_id,user_id,role) VALUES(${id}::uuid,${actor.userId},'interviewer')`,
        );
        await saveOperation(tx, actor.userId, key, prepared.fingerprint, id);
        return JSON.stringify({ id });
      });
    },
    async list(actor) {
      return transact(async (tx) => {
        const rows = (
          await tx.execute<{
            id: string;
            title: string;
            state: string;
            hostId: string;
            role: string;
            problemTitle: string;
            memberCount: number;
          }>(
            sql`SELECT i.id::text,i.title,i.state,i.host_id AS "hostId",m.role,COALESCE(q.metadata->'problem'->>'title','') AS "problemTitle",(SELECT count(*)::int FROM interview_members p WHERE p.session_id=i.id AND p.removed_at IS NULL) AS "memberCount" FROM interviews i JOIN interview_members m ON m.session_id=i.id AND m.user_id=${actor.userId} AND m.removed_at IS NULL JOIN interview_question_public q ON q.session_id=i.id AND q.question_epoch=i.question_epoch WHERE i.deleted_at IS NULL ORDER BY i.updated_at DESC LIMIT 50`,
          )
        ).rows;
        const result: string[] = [];
        for (const row of rows) {
          await lockInterview(tx, actor, row.id, capabilitiesInTransaction);
          result.push(JSON.stringify(row));
        }
        return result;
      });
    },
    async read(actor, id) {
      return deps.snapshot(actor, id);
    },
    async preview(token) {
      if (!validGuestToken(token)) throw denied();
      const hash = await guestTokenHash(token);
      return transact(async (tx) => {
        const row = (
          await tx.execute<{
            title: string;
            sessionId: string;
            state: string;
            role: InterviewRole;
            host: string;
          }>(
            sql`SELECT i.title,i.host_id AS host,i.id::text AS "sessionId",i.state,CASE WHEN i.interviewer_invite_hash=${hash} THEN 'interviewer' ELSE 'interviewee' END AS role FROM interviews i JOIN users h ON h.id=i.host_id AND NOT h.disabled WHERE (i.invite_hash=${hash} OR i.interviewer_invite_hash=${hash}) AND i.state='active' AND i.deleted_at IS NULL`,
          )
        ).rows[0];
        if (!row || !(await capabilitiesInTransaction(tx, row.host)).interviews) throw denied();
        return { title: row.title, sessionId: row.sessionId, state: row.state, role: row.role };
      });
    },
    async join(actor, token, credential, name) {
      return joinInterview(transact, actor, token, credential, name);
    },
    async setMember(actor, id, key, target, role) {
      if (role !== "interviewer" && role !== "interviewee")
        throw new ApplicationError("invalid_input", "Invalid interview role", 400);
      return mutate(actor, id, key, "member", [target, role], async (tx, host) => {
        if (target === host && role !== "interviewer")
          throw new ApplicationError("forbidden", "Host remains an interviewer", 403);
        const row = await tx.execute(
          sql`UPDATE interview_members SET role=${role} WHERE session_id=${id}::uuid AND user_id=${target} AND removed_at IS NULL RETURNING user_id`,
        );
        if (!row.rows.length) throw new ApplicationError("not_found", "Member unavailable", 404);
      });
    },
    async removeMember(actor, id, key, target) {
      return mutate(actor, id, key, "remove", target, async (tx, host) => {
        if (target === host) throw new ApplicationError("forbidden", "Host cannot be removed", 403);
        await tx.execute(
          sql`UPDATE interview_members SET removed_at=clock_timestamp() WHERE session_id=${id}::uuid AND user_id=${target}`,
        );
        await tx.execute(
          sql`UPDATE interview_guest_sessions SET revoked_at=clock_timestamp() WHERE session_id=${id}::uuid AND owner_id=${target}`,
        );
      });
    },
    async setAdmission(actor, id, key, locked) {
      return mutate(actor, id, key, "admission", locked, async (tx, host) => {
        if (actor.userId !== host)
          throw new ApplicationError("forbidden", "Only the host can lock the room", 403);
        await tx.execute(
          sql`UPDATE interviews SET admission_locked=${locked} WHERE id=${id}::uuid`,
        );
      });
    },
    async close(actor, id, key) {
      return mutate(actor, id, key, "close", null, async (tx) => {
        await tx.execute(sql`UPDATE interviews SET state='closed' WHERE id=${id}::uuid`);
      });
    },
    async delete(actor, id) {
      return transact(async (tx) => {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
          throw unavailable();
        const access = (
          await tx.execute<{ host: string; state: string }>(
            sql`SELECT host_id AS host,state FROM interviews WHERE id=${id}::uuid FOR UPDATE`,
          )
        ).rows[0];
        if (!access) throw unavailable();
        const enabled = await tx.execute(
          sql`SELECT id FROM users WHERE id=${actor.userId} AND NOT disabled`,
        );
        if (!enabled.rows.length) throw unavailable();
        if (access.host !== actor.userId)
          throw new ApplicationError("forbidden", "Only the host can delete an interview", 403);
        if (access.state !== "closed")
          throw new ApplicationError(
            "invalid_transition",
            "End the interview before deleting it",
            409,
          );
        await tx.execute(
          sql`UPDATE interviews SET deleted_at=COALESCE(deleted_at,clock_timestamp()),updated_at=clock_timestamp() WHERE id=${id}::uuid`,
        );
        await tx.execute(
          sql`UPDATE interview_guest_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE session_id=${id}::uuid`,
        );
      });
    },
  };
}
type Transact = <T>(f: (tx: Transaction) => Promise<T>) => Promise<T>;
async function joinInterview(
  transact: Transact,
  actor: Principal | undefined,
  token: string,
  credential: string | undefined,
  name: string,
) {
  if (!validGuestToken(token)) throw denied();
  const inviteHash = await guestTokenHash(token);
  return transact(async (tx) => {
    const room = (
      await tx.execute<{
        id: string;
        host: string;
        state: string;
        locked: boolean;
        role: InterviewRole;
        joins: number;
      }>(
        sql`SELECT id::text,host_id AS host,state,admission_locked AS locked,CASE WHEN interviewer_invite_hash=${inviteHash} THEN 'interviewer' ELSE 'interviewee' END AS role,guest_joins AS joins FROM interviews WHERE (invite_hash=${inviteHash} OR interviewer_invite_hash=${inviteHash}) AND deleted_at IS NULL FOR UPDATE`,
      )
    ).rows[0];
    if (!room) throw denied();
    if (room.state !== "active")
      throw new ApplicationError("invalid_transition", "Interview is closed", 409);
    if (!(await capabilitiesInTransaction(tx, room.host)).interviews)
      throw new ApplicationError("entitlement_required", "Interview access is disabled", 403);
    let user = actor?.kind === "guest" ? undefined : actor?.userId,
      guestCredential: string | undefined,
      guestDisplay = "";
    if (!user) {
      const requestedName = name || (actor?.kind === "guest" ? actor.displayName : "");
      if (requestedName) guestDisplay = guestName(requestedName);
      let current = credential && validGuestToken(credential) ? credential : undefined;
      if (current) {
        const hash = await guestTokenHash(current);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${hash},740100))`);
        const existing = (
          await tx.execute<{
            owner: string;
            session: string;
            expired: boolean;
            revoked: boolean;
            state: string;
            disabled: boolean;
            removed: boolean;
            display: string;
          }>(
            sql`SELECT g.owner_id AS owner,g.session_id::text AS session,g.expires_at<=clock_timestamp() AS expired,g.revoked_at IS NOT NULL AS revoked,i.state,u.disabled,u.display_name AS display,COALESCE(m.removed_at IS NOT NULL,true) AS removed FROM interview_guest_sessions g JOIN interviews i ON i.id=g.session_id JOIN users u ON u.id=g.owner_id LEFT JOIN interview_members m ON m.session_id=g.session_id AND m.user_id=g.owner_id WHERE g.token_hash=${hash} FOR UPDATE OF g`,
          )
        ).rows[0];
        if (existing) {
          if (
            existing.session === room.id &&
            (existing.revoked || existing.removed || existing.disabled)
          )
            throw new ApplicationError("unauthenticated", "Guest session expired or revoked", 401);
          if (existing.session === room.id && !existing.expired) {
            user = existing.owner;
            guestDisplay = guestDisplay || existing.display;
            guestCredential = current;
          } else if (
            existing.session !== room.id &&
            !existing.expired &&
            !existing.revoked &&
            !existing.removed &&
            !existing.disabled &&
            existing.state !== "closed"
          )
            throw new ApplicationError(
              "forbidden",
              "Guest credential belongs to another interview",
              403,
            );
          else current = undefined;
        } else current = undefined;
      }
      if (!user) {
        guestDisplay = guestName(guestDisplay);
        if (room.joins >= 64)
          throw new ApplicationError("quota_exceeded", "Guest admission limit reached", 429);
        guestCredential = newGuestToken();
        const hash = await guestTokenHash(guestCredential);
        user = crypto.randomUUID();
        await tx.execute(
          sql`INSERT INTO users(id,participant_id,display_name,kind) VALUES(${user},${user}::uuid,${guestDisplay},'guest')`,
        );
        await tx.execute(
          sql`INSERT INTO interview_guest_sessions(token_hash,owner_id,session_id) VALUES(${hash},${user},${room.id}::uuid)`,
        );
        await tx.execute(
          sql`UPDATE interviews SET guest_joins=guest_joins+1 WHERE id=${room.id}::uuid`,
        );
      }
    } else {
      const eligible = await tx.execute(
        sql`SELECT id FROM users WHERE id=${user} AND kind='account' AND NOT disabled`,
      );
      if (!eligible.rows.length)
        throw new ApplicationError("forbidden", "Sign in or join as an interview guest", 403);
    }
    const prior = (
      await tx.execute<{ removed: boolean }>(
        sql`SELECT removed_at IS NOT NULL AS removed FROM interview_members WHERE session_id=${room.id}::uuid AND user_id=${user}`,
      )
    ).rows[0];
    if (prior?.removed)
      throw new ApplicationError("forbidden", "Interview access was removed", 403);
    if (!prior && room.locked)
      throw new ApplicationError("admission_locked", "The host has locked this interview", 409);
    const count = (
      await tx.execute<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM interview_members WHERE session_id=${room.id}::uuid AND removed_at IS NULL`,
      )
    ).rows[0];
    if (!prior && Number(count.count) >= 12)
      throw new ApplicationError("room_full", "Interview is full", 409);
    await tx.execute(
      sql`INSERT INTO interview_members(session_id,user_id,role) VALUES(${room.id}::uuid,${user},${room.role}) ON CONFLICT(session_id,user_id) DO UPDATE SET role=CASE WHEN EXCLUDED.role='interviewer' THEN 'interviewer' ELSE interview_members.role END`,
    );
    await tx.execute(
      sql`UPDATE interviews SET version=version+1,updated_at=clock_timestamp() WHERE id=${room.id}::uuid`,
    );
    return {
      id: room.id,
      ...(guestCredential ? { credential: guestCredential } : {}),
    };
  });
}
