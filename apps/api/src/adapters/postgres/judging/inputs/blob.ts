/** @file blob.ts @description Immutable input insertion and retention fencing. @module judging */
import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";

export const INPUT_BLOB_BATCH_ROWS = 64;
/** Hold immutable rows through reference insertion; concurrent deletion or collision fails closed. */
export async function storeInputBlobs(
  tx: Transaction,
  data: readonly SQL[],
): Promise<Uint8Array[]> {
  if (!data.length || data.length > INPUT_BLOB_BATCH_ROWS) throw new Error("Invalid input batch");
  const incoming = sql.join(
    data.map((value, ordinal) => sql`(${ordinal}::int,${value}::bytea)`),
    sql`, `,
  );
  // Stable hash order avoids opposing suite orders acquiring insertion locks in reverse.
  await tx.execute(sql`WITH input(ordinal,data) AS (VALUES ${incoming})
    INSERT INTO runner_input_blobs(hash,data) SELECT DISTINCT sha256(data) AS hash,data FROM input ORDER BY hash ON CONFLICT(hash) DO NOTHING`);
  const { rows } = await tx.execute<{ ordinal: number; hash: Uint8Array }>(sql`
    WITH input(ordinal,data) AS (VALUES ${incoming}) SELECT i.ordinal,b.hash FROM runner_input_blobs b
    JOIN input i ON b.hash=sha256(i.data) AND b.data=i.data ORDER BY b.hash,i.ordinal FOR KEY SHARE OF b`);
  if (rows.length !== data.length) throw new Error("Runner input unavailable or hash collision");
  return rows.sort((a, b) => a.ordinal - b.ordinal).map((row) => row.hash);
}
export async function storeInputBlob(tx: Transaction, data: SQL): Promise<Uint8Array> {
  return (await storeInputBlobs(tx, [data]))[0];
}
