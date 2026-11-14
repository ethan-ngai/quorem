/** @file guest-retention.ts @description Remove closed guest rounds after judging has settled. @module events */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { guestLobbyClosed } from "../../matches/review/lifetime.ts";

const unsettled = sql`(
  s.state IN ('queued','running') OR EXISTS (
    SELECT 1 FROM execution_jobs j WHERE j.submission_id=s.id AND (NOT j.finished OR j.lease_until IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM guest_execution_usage u WHERE u.submission_id=s.id AND u.settled_at IS NULL
  )
)`;

async function purgeGuestRounds(tx: Transaction, limit: number): Promise<number> {
  const rounds = await tx.execute<{ id: string }>(sql`
    SELECT m.id FROM matches m
    WHERE m.state IN ('completed','cancelled') AND ${guestLobbyClosed(sql`m`)}
    AND NOT EXISTS (SELECT 1 FROM parties p WHERE p.disbanded_at IS NULL
      AND (p.current_match_id=m.id OR p.latest_match_id=m.id))
    AND NOT EXISTS (SELECT 1 FROM submissions s LEFT JOIN workspaces w ON w.id=s.workspace_id
      WHERE (s.match_id=m.id OR w.review_match_id=m.id) AND ${unsettled})
    ORDER BY m.completed_at,m.id FOR UPDATE OF m SKIP LOCKED LIMIT ${limit}
  `);
  let removed = 0;
  for (const { id } of rounds.rows) {
    // Review runs take a workspace lock first. Skip a round rather than blocking those writers.
    const workspaces = await tx.execute<{ id: string; locked: boolean }>(sql`
      WITH scoped AS MATERIALIZED (
        SELECT id FROM workspaces WHERE match_id=${id}::uuid OR review_match_id=${id}::uuid
      ), locked AS (
        SELECT w.id FROM workspaces w JOIN scoped USING(id) FOR UPDATE OF w SKIP LOCKED
      )
      SELECT scoped.id,locked.id IS NOT NULL AS locked FROM scoped LEFT JOIN locked USING(id)
    `);
    if (workspaces.rows.some((row) => !row.locked)) continue;
    const ids = workspaces.rows.map((row) => row.id);
    const inRound = sql`(s.match_id=${id}::uuid OR s.workspace_id=ANY(${sql.param(ids)}::uuid[]))`;
    const submissions = await tx.execute<{ locked: boolean }>(sql`
      WITH scoped AS MATERIALIZED (SELECT s.id FROM submissions s WHERE ${inRound}),
      locked AS (SELECT s.id FROM submissions s JOIN scoped USING(id) FOR UPDATE OF s SKIP LOCKED)
      SELECT locked.id IS NOT NULL AS locked FROM scoped LEFT JOIN locked USING(id)
    `);
    if (submissions.rows.some((row) => !row.locked)) continue;
    const pending = await tx.execute(sql`
      SELECT 1 FROM submissions s WHERE ${inRound} AND ${unsettled} LIMIT 1
    `);
    if (pending.rows.length) continue;

    await tx.execute(
      sql`DELETE FROM execution_idempotency i USING submissions s WHERE i.submission_id=s.id AND ${inRound}`,
    );
    await tx.execute(
      sql`DELETE FROM cancellation_idempotency i USING submissions s WHERE i.submission_id=s.id AND ${inRound}`,
    );
    await tx.execute(
      sql`DELETE FROM execution_jobs j USING submissions s WHERE j.submission_id=s.id AND ${inRound}`,
    );
    await tx.execute(sql`DELETE FROM submissions s WHERE ${inRound}`);
    await tx.execute(
      sql`DELETE FROM odyssey_progress WHERE scope_id=ANY(${sql.param(ids)}::uuid[])`,
    );
    await tx.execute(sql`DELETE FROM match_reservations WHERE match_id=${id}::uuid`);
    await tx.execute(sql`DELETE FROM match_participants WHERE match_id=${id}::uuid`);
    await tx.execute(sql`DELETE FROM workspaces WHERE id=ANY(${sql.param(ids)}::uuid[])`);
    await tx.execute(sql`DELETE FROM match_outbox WHERE match_id=${id}::uuid`);
    await tx.execute(sql`DELETE FROM realtime_presence_leases WHERE topic=${`/matches/${id}`}`);
    await tx.execute(sql`UPDATE parties SET current_match_id=NULLIF(current_match_id,${id}::uuid),latest_match_id=NULLIF(latest_match_id,${id}::uuid)
      WHERE current_match_id=${id}::uuid OR latest_match_id=${id}::uuid`);
    await tx.execute(sql`DELETE FROM guest_sessions WHERE match_id=${id}::uuid`);
    await tx.execute(sql`DELETE FROM matches WHERE id=${id}::uuid`);
    removed++;
  }
  return removed;
}

/** Interview memberships reference a separate guest identity and credential namespace. */
async function purgeGuestSessions(tx: Transaction, limit: number): Promise<number> {
  const closed = sql`p.disbanded_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM matches m JOIN match_participants member ON member.match_id=m.id
    WHERE m.party_id=p.id AND member.owner_id=g.owner_id
  )`;
  const sessions = await tx.execute(sql`
    DELETE FROM guest_sessions WHERE token_hash IN (
      SELECT g.token_hash FROM guest_sessions g JOIN parties p ON p.id=g.party_id
      WHERE ${closed} ORDER BY p.disbanded_at,g.token_hash FOR UPDATE OF g SKIP LOCKED LIMIT ${limit}
    )
  `);
  const lobbies = await tx.execute(sql`
    DELETE FROM parties WHERE id IN (
      SELECT p.id FROM parties p
      WHERE p.disbanded_at IS NOT NULL AND p.guest_joins>0
        AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.party_id=p.id)
        AND NOT EXISTS (SELECT 1 FROM guest_sessions g WHERE g.party_id=p.id)
        AND NOT EXISTS (SELECT 1 FROM party_members pm WHERE pm.party_id=p.id)
      ORDER BY p.disbanded_at,p.id FOR UPDATE OF p SKIP LOCKED LIMIT ${limit}
    )
  `);
  await tx.execute(sql`
    DELETE FROM match_idempotency i WHERE (owner_id,route,key) IN (
      SELECT i.owner_id,i.route,i.key FROM match_idempotency i JOIN users u ON u.id=i.owner_id
      WHERE u.kind='guest' AND NOT EXISTS (SELECT 1 FROM guest_sessions g WHERE g.owner_id=u.id)
      ORDER BY i.expires_at FOR UPDATE OF i SKIP LOCKED LIMIT ${limit}
    )
  `);
  const identities = await tx.execute(sql`
    DELETE FROM users WHERE id IN (
      SELECT u.id FROM users u WHERE u.kind='guest'
        AND NOT EXISTS (SELECT 1 FROM guest_sessions g WHERE g.owner_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM interview_members i WHERE i.user_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM interview_guest_sessions g WHERE g.owner_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM access_audit a WHERE a.user_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM entitlement_grants e WHERE e.user_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM identity_bindings b WHERE b.user_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM quota_overrides q WHERE q.user_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM guest_sponsor_locks l WHERE l.user_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM guest_execution_usage e WHERE e.sponsor_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.host_owner_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM parties p WHERE p.host_owner_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM interviews i WHERE i.host_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM problems p WHERE p.owner_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM question_drafts d WHERE u.id IN (d.owner_id,d.created_by,d.updated_by))
        AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.owner_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.owner_id=u.id OR w.review_source_owner_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM match_participants p WHERE p.owner_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM match_rule_events e WHERE e.owner_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM match_reservations r WHERE r.owner_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM party_members p WHERE p.owner_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM platform_presence_leases l WHERE l.owner_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM match_idempotency i WHERE i.owner_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM execution_idempotency i WHERE i.owner_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM cancellation_idempotency i WHERE i.owner_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM interview_operations i WHERE i.owner_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM interview_presence p WHERE p.user_id=u.id)
      ORDER BY u.id FOR UPDATE OF u SKIP LOCKED LIMIT ${limit}
    )
  `);
  return (sessions.rowCount ?? 0) + (lobbies.rowCount ?? 0) + (identities.rowCount ?? 0);
}

export async function purgeGuestMatchData(
  run: <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>,
  limit: number,
): Promise<number> {
  let removed = 0;
  for (const purge of [purgeGuestRounds, purgeGuestSessions])
    removed += await run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
        purge(tx, limit),
      ),
    );
  return removed;
}
