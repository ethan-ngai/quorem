/** @file repository.ts @description Fenced match invitation operations. @module matches */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type { MatchInvitations } from "../../../../modules/matches/invitations/model.ts";
import { validGuestToken, guestTokenHash } from "../../../../modules/identity/guest/credentials.ts";
import { capabilitiesInTransaction } from "../../access/repository.ts";
import { lookupGuestInTransaction } from "../../identity/guest.ts";
import { reconcileMatch, matchEvent } from "../reconcile/repository.ts";
import {
  lockMatch,
  lockMatchOwner,
  lockMatchHost,
  requireMatchMember,
  matchSnapshot,
  matchCommandOwner,
} from "../lifecycle/repository.ts";
import { token as newToken, digest } from "../lifecycle/crypto.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
const unavailable = () => new ApplicationError("not_found", "Invitation unavailable", 404);
const forbidden = (message: string) => new ApplicationError("forbidden", message, 403);
const closed = (message: string) => new ApplicationError("invalid_transition", message, 409);
function validate(token: string) {
  if (!validGuestToken(token)) throw unavailable();
}
async function locate(tx: Transaction, hash: string): Promise<string> {
  const row = (
    await tx.execute<{ id: string }>(
      sql`SELECT id::text AS id FROM matches WHERE invite_hash=${hash}`,
    )
  ).rows[0];
  if (!row) throw unavailable();
  return row.id;
}
async function currentInvite(tx: Transaction, id: string, hash: string) {
  const row = (
    await tx.execute<{ ok: boolean }>(
      sql`SELECT m.invite_hash=${hash} AND m.expires_at>clock_timestamp() AND m.state IN ('waiting','ready') AND NOT h.disabled AS ok FROM matches m JOIN users h ON h.id=m.host_owner_id WHERE m.id=${id}::uuid`,
    )
  ).rows[0];
  if (!row?.ok) throw unavailable();
}
async function existingInvite(tx: Transaction, id: string, hash: string) {
  const row = (
    await tx.execute<{ ok: boolean }>(
      sql`SELECT m.invite_hash=${hash} AND NOT h.disabled AS ok FROM matches m JOIN users h ON h.id=m.host_owner_id WHERE m.id=${id}::uuid`,
    )
  ).rows[0];
  if (!row?.ok) throw unavailable();
}
async function seat(tx: Transaction, id: string, capacity: number): Promise<number> {
  const row = (
    await tx.execute<{ seat: number }>(
      sql`SELECT COALESCE(min(n),0)::int AS seat FROM generate_series(1,${capacity}) n WHERE NOT EXISTS(SELECT 1 FROM match_participants WHERE match_id=${id}::uuid AND seat=n)`,
    )
  ).rows[0];
  return row.seat;
}
export function matchInvitations(run: Run, inviteKey: Uint8Array): MatchInvitations {
  const command = matchCommandOwner(run, inviteKey);
  const transact = <T>(f: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction(options, f));
  return {
    async preview(raw) {
      validate(raw);
      const hash = await guestTokenHash(raw);
      return transact(async (tx) => {
        const row = (
          await tx.execute<{ data: unknown }>(
            sql`SELECT jsonb_build_object('id',m.id,'admissionLocked',m.admission_locked,'accessMode',m.access_mode,'mode',m.mode,'difficulties',m.difficulties,'durationMinutes',m.duration_minutes,'rules',m.rules,'participantCount',(SELECT count(*) FROM match_participants p WHERE p.match_id=m.id),'capacity',CASE WHEN m.mode='free-for-all' THEN 8 ELSE 2 END) AS data FROM matches m JOIN users h ON h.id=m.host_owner_id WHERE m.invite_hash=${hash} AND m.expires_at>clock_timestamp() AND m.state IN ('waiting','ready') AND NOT h.disabled`,
          )
        ).rows[0];
        if (!row) throw unavailable();
        return row.data;
      });
    },
    async join(who, key, raw) {
      validate(raw);
      if (who.kind === "guest") throw forbidden("Use the guest invitation route");
      const hash = await guestTokenHash(raw);
      const guard = async (tx: Transaction, value: unknown) => {
        const id = (value as { id?: unknown })?.id;
        if (typeof id !== "string") throw unavailable();
        const host = await lockMatchHost(tx, id);
        const m = await lockMatch(tx, id);
        if (m.host !== host) throw unavailable();
        await existingInvite(tx, id, hash);
        await requireMatchMember(tx, who, id);
      };
      return command(
        who,
        "join",
        key,
        raw,
        async (tx) => {
          const id = await locate(tx, hash);
          const host = await lockMatchHost(tx, id);
          let m = await lockMatch(tx, id);
          if (m.host !== host) throw unavailable();
          await currentInvite(tx, id, hash);
          await reconcileMatch(tx, id);
          m = await lockMatch(tx, id);
          if (!["waiting", "ready"].includes(m.state)) throw closed("Invite is closed");
          if (m.settings.admissionLocked) throw closed("Lobby admission is locked");
          if (m.host === who.userId) throw closed("Host cannot claim guest seat");
          const n = await seat(tx, id, m.mode === "free-for-all" ? 8 : 2);
          if (!n) throw closed("Match is full");
          if (
            (await tx.execute(sql`SELECT 1 FROM match_reservations WHERE owner_id=${who.userId}`))
              .rows.length
          )
            throw new ApplicationError("user_busy", "Another match is active", 409);
          await tx.execute(
            sql`INSERT INTO match_participants(match_id,owner_id,seat) VALUES(${id}::uuid,${who.userId},${n})`,
          );
          await tx.execute(
            sql`INSERT INTO match_reservations(owner_id,match_id) VALUES(${who.userId},${id}::uuid)`,
          );
          await matchEvent(tx, id, "match.updated");
          return matchSnapshot(tx, id, who.userId);
        },
        undefined,
        guard,
      );
    },
    async joinGuest(raw, credential, inputName) {
      validate(raw);
      validate(credential);
      const name = inputName.trim();
      if (!name || Array.from(name).length > 40 || /[\r\n\t\0]/.test(name))
        throw new ApplicationError(
          "invalid_input",
          "Choose a name between 1 and 40 characters",
          400,
        );
      const inviteHash = await guestTokenHash(raw),
        hash = await guestTokenHash(credential);
      return transact(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${hash},740060))`);
        const existing = (
          await tx.execute<{ owner: string; room: string }>(
            sql`SELECT owner_id AS owner,match_id::text AS room FROM guest_sessions WHERE token_hash=${hash}`,
          )
        ).rows[0];
        if (existing) {
          const invited = await locate(tx, inviteHash).catch(() => {
            throw forbidden("Guest access is limited to one lobby");
          });
          if (invited !== existing.room) throw forbidden("Guest access is limited to one lobby");
          const who = {
            kind: "guest" as const,
            userId: existing.owner,
            displayName: name,
            admin: false as const,
            emailVerified: false as const,
            sessionId: hash,
            strongUntil: 0 as const,
            credentialExpiresAt: 0,
            scope: { kind: "match" as const, matchId: existing.room },
          };
          await lockMatchOwner(tx, who);
          const host = await lockMatchHost(tx, existing.room);
          const m = await lockMatch(tx, existing.room);
          if (m.host !== host) throw unavailable();
          await existingInvite(tx, existing.room, inviteHash);
          const actual = await lookupGuestInTransaction(tx, "match", hash);
          if (!actual || actual.userId !== existing.owner)
            throw new ApplicationError("unauthenticated", "Guest session expired or revoked", 401);
          await reconcileMatch(tx, existing.room);
          return matchSnapshot(tx, existing.room, existing.owner);
        }
        const id = await locate(tx, inviteHash),
          host = await lockMatchHost(tx, id),
          m = await lockMatch(tx, id);
        if (m.host !== host) throw unavailable();
        await currentInvite(tx, id, inviteHash);
        const room = (
          await tx.execute<{ allowed: boolean }>(
            sql`SELECT access_mode='guests_allowed' AND NOT admission_locked AND guest_joins<32 AND expires_at>clock_timestamp() AND state IN ('waiting','ready') AS allowed FROM matches WHERE id=${id}::uuid`,
          )
        ).rows[0];
        if (!room?.allowed) throw forbidden("This lobby is not accepting guests");
        if (!(await capabilitiesInTransaction(tx, m.host)).hostGuests)
          throw new ApplicationError("entitlement_required", "Guest hosting is unavailable", 403);
        const n = await seat(tx, id, m.mode === "free-for-all" ? 8 : 2);
        if (!n) throw new ApplicationError("room_full", "Lobby is full", 409);
        const owner = crypto.randomUUID();
        await tx.execute(
          sql`INSERT INTO users(id,participant_id,display_name,kind) VALUES(${owner},${owner}::uuid,${name},'guest')`,
        );
        await tx.execute(
          sql`INSERT INTO match_participants(match_id,owner_id,seat) VALUES(${id}::uuid,${owner},${n})`,
        );
        await tx.execute(
          sql`INSERT INTO match_reservations(owner_id,match_id) VALUES(${owner},${id}::uuid)`,
        );
        await tx.execute(
          sql`INSERT INTO guest_sessions(token_hash,owner_id,match_id,expires_at) SELECT ${hash},${owner},id,LEAST(clock_timestamp()+interval '24 hours',expires_at+interval '2 hours') FROM matches WHERE id=${id}::uuid`,
        );
        await tx.execute(sql`UPDATE matches SET guest_joins=guest_joins+1 WHERE id=${id}::uuid`);
        await matchEvent(tx, id, "match.updated");
        return matchSnapshot(tx, id, owner);
      });
    },
    async rotate(who, id, key) {
      if (who.kind === "guest") throw forbidden("Only the host can rotate an open invitation");
      const guard = async (tx: Transaction, value: unknown) => {
        const m = await lockMatch(tx, id);
        await requireMatchMember(tx, who, id);
        if (m.host !== who.userId || m.started || m.outcome)
          throw forbidden("Only the host can rotate an open invitation");
        const link = (value as { inviteUrl?: unknown })?.inviteUrl;
        if (typeof link !== "string" || !link.startsWith("/invite/")) throw unavailable();
        await currentInvite(tx, id, await digest(link.slice(8)));
      };
      return command(
        who,
        "rotate",
        key,
        id,
        async (tx) => {
          const m = await lockMatch(tx, id);
          await requireMatchMember(tx, who, id);
          if (m.host !== who.userId || m.started || m.outcome)
            throw forbidden("Only the host can rotate an open invitation");
          const secret = newToken();
          await tx.execute(
            sql`UPDATE matches SET invite_hash=${await digest(secret)} WHERE id=${id}::uuid`,
          );
          await matchEvent(tx, id, "match.updated");
          return { id, state: m.state, inviteUrl: `/invite/${secret}` };
        },
        undefined,
        guard,
      );
    },
    async removeGuest(who, id, guest, key) {
      return command(who, `remove-guest:${id}`, key, guest, async (tx) => {
        let m = await lockMatch(tx, id);
        await requireMatchMember(tx, who, id);
        await reconcileMatch(tx, id);
        m = await lockMatch(tx, id);
        if (m.host !== who.userId) throw forbidden("Only the host can remove guests");
        if (m.started) throw closed("Guest removal is available before the match starts");
        const target = (
          await tx.execute<{ owner: string }>(
            sql`SELECT p.owner_id AS owner FROM match_participants p JOIN users u ON u.id=p.owner_id WHERE p.match_id=${id}::uuid AND u.kind='guest' AND (u.id=${guest} OR u.participant_id::text=${guest})`,
          )
        ).rows[0];
        if (!target) throw new ApplicationError("not_found", "Guest not found", 404);
        await tx.execute(
          sql`UPDATE guest_sessions SET revoked_at=clock_timestamp() WHERE match_id=${id}::uuid AND owner_id=${target.owner}`,
        );
        await tx.execute(
          sql`DELETE FROM match_participants WHERE match_id=${id}::uuid AND owner_id=${target.owner}`,
        );
        await tx.execute(
          sql`DELETE FROM match_reservations WHERE match_id=${id}::uuid AND owner_id=${target.owner}`,
        );
        if (!m.outcome) await matchEvent(tx, id, "match.updated");
        return matchSnapshot(tx, id, who.userId);
      });
    },
  };
}
