/** @file guest.ts @description Live guest sessions and public admission. @module identity */
import { sql } from 'drizzle-orm';
import type { ConnectionScope, Transaction } from '@quorem/database/core';
import { requireTrustedPeer } from '../../../modules/access/guest.ts';
import type { GuestKind } from '../../../modules/identity/guest/credentials.ts';
import type { GuestPrincipal, GuestScope } from '../../../modules/identity/model.ts';
const options = { statementTimeoutMs: 3000, lockTimeoutMs: 1000 };
type Row = { user_id: string; display_name: string; scope_id: string; expires: string };
/** Caller owns the transaction and aggregate authorization. */
export async function lookupGuestInTransaction(tx: Transaction, kind: GuestKind, hash: string): Promise<GuestPrincipal | null> {
  const lock = kind === 'match' ? sql`SELECT token_hash FROM guest_sessions WHERE token_hash=${hash} FOR UPDATE` : sql`SELECT token_hash FROM interview_guest_sessions WHERE token_hash=${hash} FOR UPDATE`;
  await tx.execute(lock);
  const query = kind === 'match' ? sql`UPDATE guest_sessions g SET last_seen_at=clock_timestamp() FROM users u,match_participants p,matches m,users h WHERE g.token_hash=${hash} AND u.id=g.owner_id AND u.kind='guest' AND NOT u.disabled AND p.owner_id=g.owner_id AND p.match_id=g.match_id AND m.id=g.match_id AND h.id=m.host_owner_id AND NOT h.disabled AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND g.last_seen_at>clock_timestamp()-interval '2 hours' RETURNING u.id AS user_id,u.display_name,g.match_id::text AS scope_id,floor(extract(epoch FROM g.expires_at))::bigint::text AS expires` : sql`SELECT u.id AS user_id,u.display_name,g.session_id::text AS scope_id,floor(extract(epoch FROM g.expires_at))::bigint::text AS expires FROM interview_guest_sessions g JOIN users u ON u.id=g.owner_id AND u.kind='guest' AND NOT u.disabled JOIN interview_members m ON m.session_id=g.session_id AND m.user_id=g.owner_id AND m.removed_at IS NULL JOIN interviews i ON i.id=g.session_id JOIN users h ON h.id=i.host_id AND NOT h.disabled WHERE g.token_hash=${hash} AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()`;
  const row = (await tx.execute<Row>(query)).rows[0];
  if (!row) return null;
  return { kind: 'guest', userId: row.user_id, displayName: row.display_name, admin: false, emailVerified: false, sessionId: hash, strongUntil: 0, credentialExpiresAt: Number(row.expires), scope: kind === 'match' ? { kind, matchId: row.scope_id } : { kind, interviewId: row.scope_id } };
}
/** Caller must authorize and lock the owning aggregate before revocation. */
export async function revokeGuestInTransaction(tx: Transaction, scope: GuestScope, ownerId: string): Promise<boolean> {
  const query = scope.kind === 'match'
    ? sql`UPDATE guest_sessions SET revoked_at=clock_timestamp() WHERE match_id=${scope.matchId}::uuid AND owner_id=${ownerId} AND revoked_at IS NULL RETURNING token_hash`
    : sql`UPDATE interview_guest_sessions SET revoked_at=clock_timestamp() WHERE session_id=${scope.interviewId}::uuid AND owner_id=${ownerId} AND revoked_at IS NULL RETURNING token_hash`;
  return (await tx.execute(query)).rows.length > 0;
}
export function guestRepository(scope: ConnectionScope) {
  return {
    async lookup(kind: GuestKind, hash: string): Promise<GuestPrincipal | null> {
      return scope.transaction(options, (tx) => lookupGuestInTransaction(tx, kind, hash));
    },
    async endMatch(hash: string): Promise<boolean> {
      return scope.transaction(options, async (tx) => {
        const current = (await tx.execute<{ match_id: string }>(sql`SELECT match_id::text FROM guest_sessions WHERE token_hash=${hash}`)).rows[0];
        if (!current) return false;
        await tx.execute(sql`SELECT id FROM matches WHERE id=${current.match_id}::uuid FOR UPDATE`);
        await tx.execute(sql`SELECT token_hash FROM guest_sessions WHERE token_hash=${hash} FOR UPDATE`);
        return (await tx.execute(sql`UPDATE guest_sessions g SET revoked_at=clock_timestamp() FROM matches m WHERE g.token_hash=${hash} AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND m.id=g.match_id AND (m.state IN ('completed','cancelled') OR EXISTS(SELECT 1 FROM match_participants p WHERE p.match_id=m.id AND p.owner_id=g.owner_id AND p.forfeited)) RETURNING g.token_hash`)).rows.length === 1;
      });
    },
  };
}
class BudgetExceeded extends Error {}
export function publicGuestBudget(scope: ConnectionScope) {
  return {
    async allow(peer: string): Promise<boolean> {
      peer = requireTrustedPeer(peer);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(peer))), (byte) => byte.toString(16).padStart(2, '0')).join('');
      try {
        return await scope.transaction(options, async (tx) => {
          const window = (await tx.execute<{ value: string }>(sql`SELECT date_trunc('minute',clock_timestamp())::text AS value`)).rows[0].value;
          for (const [key, limit] of [['global', 6000], [`peer:${hash}`, 1200]] as const) {
            const result = await tx.execute(sql`INSERT INTO guest_request_buckets(key,window_start,used) VALUES(${key},${window}::timestamptz,1) ON CONFLICT(key,window_start) DO UPDATE SET used=guest_request_buckets.used+1 WHERE guest_request_buckets.used<${limit} RETURNING used`);
            if (!result.rows.length) throw new BudgetExceeded();
          }
          const current = (await tx.execute<{ valid: boolean }>(sql`SELECT date_trunc('minute',clock_timestamp())=${window}::timestamptz AS valid`)).rows[0].valid;
          if (!current) throw new BudgetExceeded();
          return true;
        });
      } catch (error) { if (error instanceof BudgetExceeded) return false; throw error; }
    },
  };
}
