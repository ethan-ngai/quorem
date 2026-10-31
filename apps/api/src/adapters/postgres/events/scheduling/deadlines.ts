/** @file deadlines.ts @description Database-clock match deadline discovery. @module events */
import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import type { DeadlineStore } from "../../../../modules/events/scheduling/scheduling.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1000, readOnly: true };
const due = sql`CASE WHEN m.started_at IS NULL THEN m.expires_at WHEN m.finalizing_at IS NOT NULL THEN m.finalizing_at + interval '2 minutes' ELSE m.deadline END`;
const shardFilter = (shard: number, shards: number) => {
  if (
    !Number.isSafeInteger(shards) ||
    shards < 1 ||
    shards > 256 ||
    !Number.isSafeInteger(shard) ||
    shard < 0 ||
    shard >= shards
  )
    throw new RangeError("Invalid shard");
  return sql`mod((('x' || substr(m.id::text, 1, 8))::bit(32)::bigint), ${shards}) = ${shard}`;
};
export function postgresDeadlines(run: Run): DeadlineStore {
  return {
    async candidates(shard, shards, limit) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
        throw new RangeError("Invalid batch");
      return run((scope) =>
        scope.transaction(options, async (tx) =>
          (
            await tx.execute(
              sql`SELECT m.id::text AS id, p.generation::text AS generation FROM matches m LEFT JOIN match_reconciliation_pending p ON p.match_id=m.id WHERE ${shardFilter(shard, shards)} AND (p.match_id IS NOT NULL OR (m.state NOT IN ('completed','cancelled') AND ${due} <= clock_timestamp())) ORDER BY ${due} NULLS FIRST, m.id LIMIT ${limit}`,
            )
          ).rows.map((row) => ({
            id: String(row.id),
            generation: typeof row.generation === "string" ? row.generation : null,
          })),
        ),
      );
    },
    async delay(shard, shards) {
      return run((scope) =>
        scope.transaction(options, async (tx) => {
          const result = await tx.execute(
            sql`SELECT CEIL(EXTRACT(EPOCH FROM (MIN(CASE WHEN p.match_id IS NOT NULL THEN clock_timestamp() ELSE ${due} END)-clock_timestamp())) * 1000)::bigint AS delay FROM matches m LEFT JOIN match_reconciliation_pending p ON p.match_id=m.id WHERE ${shardFilter(shard, shards)} AND (p.match_id IS NOT NULL OR m.state NOT IN ('completed','cancelled'))`,
          );
          return result.rows[0]?.delay == null ? null : Math.max(0, Number(result.rows[0].delay));
        }),
      );
    },
  };
}
