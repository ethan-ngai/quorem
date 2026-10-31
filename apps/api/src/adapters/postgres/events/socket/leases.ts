/** @file leases.ts @description Cross-instance browser-window leases. @module events */
import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const valid = (topic: string, subject: string) => {
  const t = encoder.encode(topic).length,
    s = encoder.encode(subject).length;
  return t > 0 && t <= 128 && s > 0 && s <= 128;
};
/** The owner supplies its current authorization inside this transaction. */
export async function acquireSocketLease(
  tx: Transaction,
  topic: string,
  subject: string,
  authorize: () => Promise<unknown>,
  guard: SQL = sql`true`,
): Promise<string> {
  if (!valid(topic, subject))
    throw new ApplicationError("invalid_input", "Invalid socket lease", 400);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${topic}:${subject}`},0))`);
  await tx.execute(
    sql`DELETE FROM realtime_presence_leases WHERE id IN(SELECT id FROM realtime_presence_leases WHERE expires_at<=clock_timestamp() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 256)`,
  );
  const row = (
    await tx.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM realtime_presence_leases WHERE topic=${topic} AND subject=${subject} AND expires_at>clock_timestamp()`,
    )
  ).rows[0];
  if (Number(row.count) >= 4)
    throw new ApplicationError("quota_exceeded", "Too many editor windows", 429);
  await authorize();
  const id = crypto.randomUUID();
  const inserted = await tx.execute(
    sql`INSERT INTO realtime_presence_leases(id,topic,subject,expires_at) SELECT ${id}::uuid,${topic},${subject},clock_timestamp()+interval '30 seconds' WHERE ${guard} RETURNING id`,
  );
  if (!inserted.rows.length) throw new ApplicationError("not_found", "Socket unavailable", 404);
  return id;
}
export async function renewSocketLease(
  tx: Transaction,
  topic: string,
  subject: string,
  id: string,
  authorize: () => Promise<unknown>,
  guard: SQL = sql`true`,
): Promise<boolean> {
  if (!valid(topic, subject) || !uuid.test(id)) return false;
  await authorize();
  return (
    (
      await tx.execute(
        sql`UPDATE realtime_presence_leases SET expires_at=clock_timestamp()+interval '30 seconds' WHERE id=${id}::uuid AND topic=${topic} AND subject=${subject} AND expires_at>clock_timestamp() AND ${guard} RETURNING id`,
      )
    ).rows.length === 1
  );
}
/** Cleanup cannot authorize a socket and is fenced by the original lease tuple. */
export async function releaseSocketLease(
  tx: Transaction,
  topic: string,
  subject: string,
  id: string,
): Promise<void> {
  if (!valid(topic, subject) || !uuid.test(id)) return;
  await tx.execute(
    sql`DELETE FROM realtime_presence_leases WHERE id=${id}::uuid AND topic=${topic} AND subject=${subject}`,
  );
}
