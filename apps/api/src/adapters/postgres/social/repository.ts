/** @file repository.ts @description Authoritative social projections, without private match details. @module social */
import { sql, type SQL } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import type { PlayerIdentity, PlayerProfile, Rival, ShowdownRecord } from "@quorem/contracts";
import { ApplicationError } from "../../../application/error.ts";
import {
  rivalryMinimumMatches,
  rivalryWindowDays,
  socialPageSize,
  type SocialReader,
} from "../../../modules/social/model.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const identity = (username: SQL) =>
  sql`jsonb_build_object('id',u.participant_id,'displayName',u.display_name,'username',${username},'image',u.profile_image,'color',u.profile_color)`;
const record = sql`jsonb_build_object('played',count(*)::int,'wins',count(*) FILTER (WHERE result='win')::int,'draws',count(*) FILTER (WHERE result='draw')::int,'losses',count(*) FILTER (WHERE result='loss')::int)`;

/** Shared eligibility keeps profiles and rivalry comparisons on the same rules/window. */
function encounters(owner: string) {
  return sql`WITH encounters AS (
    SELECT opponent.owner_id AS opponent_id, m.completed_at,
      CASE WHEN m.outcome->>'kind'='draw' THEN 'draw'
        WHEN m.outcome->>'winnerUserId'=self.participant_id::text THEN 'win' ELSE 'loss' END AS result
    FROM match_participants mine JOIN matches m ON m.id=mine.match_id
    JOIN users self ON self.id=mine.owner_id
    JOIN match_participants opponent ON opponent.match_id=m.id AND opponent.owner_id<>mine.owner_id
    JOIN users other ON other.id=opponent.owner_id
    WHERE mine.owner_id=${owner} AND m.mode='showdown' AND m.state='completed'
      AND m.started_at IS NOT NULL AND m.completed_at >= transaction_timestamp()-${rivalryWindowDays}*interval '1 day'
      AND self.kind='account' AND NOT self.disabled AND other.kind='account' AND NOT other.disabled
      AND (SELECT count(*) FROM match_participants p WHERE p.match_id=m.id)=2
      AND (m.outcome->>'kind'='draw' OR (m.outcome->>'kind'='win'
        AND m.outcome->>'winnerUserId' IN (self.participant_id::text,other.participant_id::text)))
  )`;
}
async function stats(
  tx: Transaction,
  owner: string,
  filter: SQL = sql`true`,
): Promise<ShowdownRecord> {
  const result = await tx.execute<{ record: ShowdownRecord }>(
    sql`${encounters(owner)} SELECT ${record} AS record FROM encounters WHERE ${filter}`,
  );
  return result.rows[0].record;
}
/** @returns Account-only reads; persisted account authority is checked inside every snapshot. */
export function socialRepository(run: Run, authIssuer: string): SocialReader {
  // Subjects are issuer-scoped; only the configured auth service can supply handles.
  const username = sql`(SELECT a.username FROM identity_bindings b JOIN quorem_auth."user" a ON a.id=b.subject WHERE b.user_id=u.id AND b.issuer=${authIssuer} ORDER BY a.id LIMIT 1)`;
  const playerIdentity = identity(username);
  const read = <T>(userId: string, fn: (tx: Transaction, viewer: PlayerIdentity) => Promise<T>) =>
    run((scope) =>
      scope.transaction(
        {
          readOnly: true,
          isolation: "repeatable read",
          statementTimeoutMs: 4000,
          lockTimeoutMs: 1000,
        },
        async (tx) => {
          const result = await tx.execute<{ player: PlayerIdentity }>(
            sql`SELECT ${playerIdentity} AS player FROM users u WHERE u.id=${userId} AND u.kind='account' AND NOT u.disabled`,
          );
          if (!result.rows[0]) throw new ApplicationError("forbidden", "Account required", 403);
          return fn(tx, result.rows[0].player);
        },
      ),
    );
  return {
    overview(userId) {
      return read(userId, async (tx, viewer) => {
        const rows = await tx.execute<{ rival: Rival }>(sql`${encounters(userId)}, rivals AS (
          SELECT opponent_id, ${record} AS record, max(completed_at) AS last_played,
            count(*) FILTER (WHERE result='loss') AS losses, count(*) AS played
          FROM encounters GROUP BY opponent_id HAVING count(*)>=${rivalryMinimumMatches}
        ) SELECT jsonb_build_object('player',${playerIdentity},'record',r.record,'lastPlayedAt',r.last_played) AS rival
          FROM rivals r JOIN users u ON u.id=r.opponent_id
          ORDER BY r.losses DESC,r.played DESC,r.last_played DESC,u.participant_id LIMIT ${socialPageSize}`);
        return {
          viewer,
          windowDays: rivalryWindowDays,
          minimumMatches: rivalryMinimumMatches,
          rivals: rows.rows.map((r) => r.rival),
        };
      });
    },
    players(userId, search, offset) {
      return read(userId, async (tx) => {
        // Literal substring search: wildcard characters carry no special meaning.
        const filter = sql`u.kind='account' AND NOT u.disabled AND (strpos(lower(u.display_name),lower(${search}))>0 OR strpos(lower(COALESCE(${username},'')),lower(${search.replace(/^@/, "")}))>0)`;
        const total = await tx.execute<{ total: number }>(
          sql`SELECT count(*)::int AS total FROM users u WHERE ${filter}`,
        );
        const rows = await tx.execute<{ player: PlayerIdentity }>(
          sql`SELECT ${playerIdentity} AS player FROM users u WHERE ${filter} ORDER BY lower(u.display_name),u.participant_id LIMIT ${socialPageSize} OFFSET ${offset}`,
        );
        return { items: rows.rows.map((r) => r.player), total: total.rows[0].total };
      });
    },
    profile(userId, participantId) {
      return read(userId, async (tx, viewer): Promise<PlayerProfile> => {
        const rows = await tx.execute<{ owner: string; player: PlayerIdentity }>(
          sql`SELECT u.id AS owner,${playerIdentity} AS player FROM users u WHERE u.participant_id=${participantId}::uuid AND u.kind='account' AND NOT u.disabled`,
        );
        const target = rows.rows[0];
        if (!target) throw new ApplicationError("not_found", "Player unavailable", 404);
        return {
          player: target.player,
          record: await stats(tx, target.owner),
          headToHead: await stats(tx, userId, sql`opponent_id=${target.owner}`),
          isSelf: viewer.id === target.player.id,
          windowDays: rivalryWindowDays,
        };
      });
    },
  };
}
