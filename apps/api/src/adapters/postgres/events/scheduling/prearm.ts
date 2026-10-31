/** @file prearm.ts @description Durable activation receipts and lock-fenced cleanup. @module events */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
export type ReceiptPurpose = "deadline" | "execution";
export function prearmReceipts(run: Run, purpose: ReceiptPurpose = "deadline") {
  return {
    async create(id: string, shard: number) {
      if (!Number.isInteger(shard) || shard < 0 || shard > 255)
        throw new RangeError("Invalid shard");
      await run((scope) =>
        scope.transaction(options, async (tx) => {
          await tx.execute(
            sql`INSERT INTO deadline_prearms(id,purpose,shard,expires_at) VALUES (${id}::uuid,${purpose},${shard},clock_timestamp()+interval '10 seconds')`,
          );
        }),
      );
    },
    // Lock waits and database outages are retryable, never evidence of abandonment.
    async settle(id: string): Promise<"committed" | "pending" | "abandoned"> {
      return run((scope) =>
        scope.transaction(options, async (tx) => {
          const result = await tx.execute(
            sql`SELECT committed_at IS NOT NULL AS committed, expires_at <= clock_timestamp() AS expired FROM deadline_prearms WHERE id=${id}::uuid AND purpose=${purpose} FOR UPDATE`,
          );
          const row = result.rows[0];
          if (!row) return "abandoned";
          if (row.committed) return "committed";
          if (!row.expired) return "pending";
          await tx.execute(
            sql`DELETE FROM deadline_prearms WHERE id=${id}::uuid AND purpose=${purpose} AND committed_at IS NULL AND expires_at <= clock_timestamp()`,
          );
          return "abandoned";
        }),
      );
    },
    async acknowledge(id: string) {
      await run((scope) =>
        scope.transaction(options, async (tx) => {
          await tx.execute(
            sql`DELETE FROM deadline_prearms WHERE id=${id}::uuid AND purpose=${purpose} AND committed_at IS NOT NULL`,
          );
        }),
      );
    },
    async list(shard: number, limit = 64) {
      if (
        !Number.isInteger(shard) ||
        shard < 0 ||
        shard > 255 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 64
      )
        throw new RangeError("Invalid receipt scan");
      return run((scope) =>
        scope.transaction({ ...options, readOnly: true }, async (tx) =>
          (
            await tx.execute(
              sql`SELECT id::text FROM deadline_prearms WHERE purpose=${purpose} AND shard=${shard} ORDER BY expires_at,id LIMIT ${limit}`,
            )
          ).rows.map((row) => String(row.id)),
        ),
      );
    },
  };
}
/** Lock and consume the receipt inside the same transaction that activates the deadline. */
export async function consumePrearm(
  tx: Transaction,
  id: string,
  shard: number,
  purpose: ReceiptPurpose = "deadline",
): Promise<void> {
  await tx.execute(
    sql`SELECT id FROM deadline_prearms WHERE id=${id}::uuid AND purpose=${purpose} AND shard=${shard} FOR UPDATE`,
  );
  const result = await tx.execute(
    sql`UPDATE deadline_prearms SET committed_at=clock_timestamp() WHERE id=${id}::uuid AND purpose=${purpose} AND shard=${shard} AND committed_at IS NULL AND expires_at > clock_timestamp() RETURNING id`,
  );
  if (result.rows.length !== 1) throw new Error("Deadline prearm unavailable");
}
