/** @file deadlines.ts @description Database-clock match and party deadline discovery. @module events */
import { reviewPending } from "../../matches/review/pending.ts";
import { matchSubmissionDeadline } from "../../matches/rules/ledger.ts";
import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import type { DeadlineStore } from "../../../../modules/events/scheduling/scheduling.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1000, readOnly: true };
const due = sql`CASE WHEN m.started_at IS NULL THEN m.expires_at WHEN m.finalizing_at IS NOT NULL THEN m.finalizing_at + interval '2 minutes' ELSE LEAST(${matchSubmissionDeadline(sql`m`)},m.rule_deadline) END`;
const candidates = (shard: number, shards: number) => {
  if (
    !Number.isSafeInteger(shards) ||
    shards < 1 ||
    shards > 256 ||
    !Number.isSafeInteger(shard) ||
    shard < 0 ||
    shard >= shards
  )
    throw new RangeError("Invalid shard");
  return sql`WITH pending AS (
    SELECT m.id::text AS id,p.generation::text AS generation,CASE WHEN p.match_id IS NOT NULL THEN clock_timestamp() ELSE ${due} END AS due
    FROM matches m LEFT JOIN match_reconciliation_pending p ON p.match_id=m.id
    WHERE mod((('x'||substr(m.id::text,1,8))::bit(32)::bigint),${shards})=${shard} AND (p.match_id IS NOT NULL OR m.state NOT IN ('completed','cancelled'))
    UNION ALL
    SELECT 'party:'||p.id::text,NULL::text,LEAST(p.countdown_ends_at,
      CASE WHEN EXISTS(SELECT 1 FROM matches m WHERE m.id=p.current_match_id AND m.state IN ('completed','cancelled')) THEN clock_timestamp()+CASE WHEN ${reviewPending(sql`p.current_match_id`)} THEN interval '2 seconds' ELSE interval '0 seconds' END END,
      (SELECT min(GREATEST(pm.last_seen_at+interval '5 minutes',COALESCE((SELECT max(l.expires_at) FROM realtime_presence_leases l WHERE l.subject=pm.owner_id),'-infinity'::timestamptz))) FROM party_members pm WHERE pm.party_id=p.id),
      (SELECT min(COALESCE(GREATEST((SELECT max(l.expires_at) FROM platform_presence_leases l WHERE l.owner_id=pm.owner_id),(SELECT max(l.expires_at) FROM realtime_presence_leases l WHERE l.subject=pm.owner_id)),clock_timestamp())) FROM party_members pm WHERE pm.party_id=p.id AND pm.ready))
    FROM parties p WHERE p.disbanded_at IS NULL AND mod((('x'||substr(p.id::text,1,8))::bit(32)::bigint),${shards})=${shard}
  )`;
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
              sql`${candidates(shard, shards)} SELECT id,generation FROM pending WHERE due<=clock_timestamp() ORDER BY due,id LIMIT ${limit}`,
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
            sql`${candidates(shard, shards)} SELECT CEIL(EXTRACT(EPOCH FROM (min(due)-clock_timestamp()))*1000)::bigint AS delay FROM pending`,
          );
          return result.rows[0]?.delay == null ? null : Math.max(0, Number(result.rows[0].delay));
        }),
      );
    },
  };
}
