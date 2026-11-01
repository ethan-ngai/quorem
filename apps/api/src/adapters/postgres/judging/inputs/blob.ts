/** @file blob.ts @description Immutable input insertion and retention fencing. @module judging */
import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";

/** Hold the existing row through reference insertion; a concurrent deletion fails closed. */
export async function storeInputBlob(tx: Transaction, data: SQL): Promise<Uint8Array> {
  await tx.execute(
    sql`WITH input AS (SELECT ${data}::bytea AS data) INSERT INTO runner_input_blobs(hash,data) SELECT sha256(data),data FROM input ON CONFLICT(hash) DO NOTHING`,
  );
  const row = (
    await tx.execute<{ hash: Uint8Array }>(
      sql`WITH input AS (SELECT ${data}::bytea AS data) SELECT b.hash FROM runner_input_blobs b,input i WHERE b.hash=sha256(i.data) AND b.data=i.data FOR KEY SHARE OF b`,
    )
  ).rows[0];
  if (!row) throw new Error("Runner input unavailable or hash collision");
  return row.hash;
}
