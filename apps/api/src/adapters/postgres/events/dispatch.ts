/** @file dispatch.ts @description PostgreSQL dispatch claims and atomic intents. @module events */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import type { Claim, DispatchStore } from "../../../modules/events/dispatch/ports.ts";

type Scope = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const tables = {
  interview: "interview_outbox",
  match: "match_outbox",
  submission: "submission_outbox",
  membership: "membership_outbox",
  execution: "execution_dispatch_intents",
} as const;
const aggregate = {
  interview: "session_id",
  match: "match_id",
  submission: "submission_id",
  membership: "participant_id",
} as const;
const txn = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };

/** Called inside the admission transaction after the job insert. */
export async function insertExecutionIntent(
  tx: Transaction,
  id: string,
  jobId: string,
): Promise<void> {
  await tx.execute(
    sql`INSERT INTO execution_dispatch_intents(id, job_id) VALUES (${id}::uuid, ${jobId}::uuid)`,
  );
}

export function postgresDispatch(run: Scope): DispatchStore {
  return {
    async claim(stream, limit, leaseMs) {
      if (
        !Object.hasOwn(tables, stream) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 64 ||
        !Number.isSafeInteger(leaseMs) ||
        leaseMs < 1000 ||
        leaseMs > 300_000
      )
        throw new RangeError("Invalid dispatch claim");
      const table = sql.raw(tables[stream]);
      const execution = stream === "execution";
      const pending = sql.raw(execution ? "delivered_at" : "published_at");
      const order = sql.raw(execution ? "available_at, id" : "sequence");
      const available = execution ? sql`AND available_at <= clock_timestamp()` : sql``;
      const fields = execution
        ? sql`q.job_id::text AS "jobId"`
        : sql`q.${sql.raw(aggregate[stream])}::text AS "aggregateId", ${stream === "match" ? sql`q.version::text` : sql`q.sequence::text`} AS version, ${stream === "interview" || stream === "match" ? sql`q.event_type` : sql`${stream + ".updated"}`} AS type, q.occurred_at::text AS "occurredAt"`;
      const token = crypto.randomUUID();
      return run((scope) =>
        scope.transaction(txn, async (tx) => {
          const result = await tx.execute(
            sql`WITH candidates AS (SELECT id FROM ${table} WHERE ${pending} IS NULL ${available} AND (dispatch_until IS NULL OR dispatch_until < clock_timestamp()) ORDER BY ${order} FOR UPDATE SKIP LOCKED LIMIT ${limit}) UPDATE ${table} q SET dispatch_token=${token}::uuid, dispatch_until=clock_timestamp()+(${leaseMs} * interval '1 millisecond') FROM candidates c WHERE q.id=c.id AND q.${pending} IS NULL AND (q.dispatch_until IS NULL OR q.dispatch_until < clock_timestamp()) RETURNING q.id::text AS id, ${fields}`,
          );
          return result.rows.map((row) =>
            execution
              ? { stream, id: String(row.id), token, jobId: String(row.jobId) }
              : {
                  stream,
                  id: String(row.id),
                  token,
                  notice: {
                    id: String(row.id),
                    aggregateId: String(row.aggregateId),
                    version: String(row.version),
                    type: String(row.type),
                    occurredAt: String(row.occurredAt),
                  },
                },
          ) as Claim[];
        }),
      );
    },
    async acknowledge(claim) {
      if (!Object.hasOwn(tables, claim.stream)) throw new RangeError("Invalid stream");
      const table = sql.raw(tables[claim.stream]),
        done = sql.raw(claim.stream === "execution" ? "delivered_at" : "published_at");
      return run((scope) =>
        scope.transaction(txn, async (tx) => {
          const result = await tx.execute(
            sql`UPDATE ${table} SET ${done}=clock_timestamp(), dispatch_token=NULL, dispatch_until=NULL WHERE id=${claim.id}::uuid AND dispatch_token=${claim.token}::uuid AND dispatch_until > clock_timestamp() AND ${done} IS NULL RETURNING id`,
          );
          return result.rows.length === 1;
        }),
      );
    },
    async pending(stream) {
      if (!Object.hasOwn(tables, stream)) throw new RangeError("Invalid stream");
      const table = sql.raw(tables[stream]),
        done = sql.raw(stream === "execution" ? "delivered_at" : "published_at");
      return run((scope) =>
        scope.transaction(
          { ...txn, readOnly: true },
          async (tx) =>
            (
              await tx.execute(
                sql`SELECT EXISTS(SELECT 1 FROM ${table} WHERE ${done} IS NULL) AS pending`,
              )
            ).rows[0]?.pending === true,
        ),
      );
    },
  };
}

/** Sweeper repair for an accepted wake whose downstream retries were exhausted. */
export async function recoverExecutionIntents(run: Scope, limit = 64): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
    throw new RangeError("Invalid recovery limit");
  return run((scope) =>
    scope.transaction(txn, async (tx) => {
      const result = await tx.execute(sql`WITH repair AS (
      SELECT i.id FROM execution_dispatch_intents i JOIN execution_jobs j ON j.id=i.job_id
      WHERE i.delivered_at < clock_timestamp() - interval '1 minute'
        AND NOT j.finished AND (j.lease_until IS NULL OR j.lease_until < clock_timestamp())
      ORDER BY i.delivered_at, i.id FOR UPDATE OF i SKIP LOCKED LIMIT ${limit}
    ) UPDATE execution_dispatch_intents i SET delivered_at=NULL, available_at=clock_timestamp(), dispatch_token=NULL, dispatch_until=NULL
      FROM repair r, execution_jobs j WHERE i.id=r.id AND j.id=i.job_id AND NOT j.finished
        AND (j.lease_until IS NULL OR j.lease_until < clock_timestamp())
        AND i.delivered_at < clock_timestamp() - interval '1 minute' RETURNING i.id`);
      return result.rows.length;
    }),
  );
}
