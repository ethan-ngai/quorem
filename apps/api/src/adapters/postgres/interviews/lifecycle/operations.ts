/** @file operations.ts @description Go-compatible lifecycle operation identity. @module interviews */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
const quote = (text: string) =>
  JSON.stringify(text).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
/** Encodes the existing scalar and string-array operation bodies exactly as Go. */
export async function operationFingerprint(
  scope: string,
  body: null | boolean | string | readonly string[],
): Promise<string> {
  const payload =
    body === null
      ? "null"
      : typeof body === "boolean"
        ? String(body)
        : typeof body === "string"
          ? quote(body)
          : `[${body.map(quote).join(",")}]`;
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${scope}:${payload}`),
  );
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function priorOperationRecord(
  tx: Transaction,
  user: string,
  key: string,
  hash: string,
): Promise<{ id: string; response: unknown } | null> {
  if (!key || new TextEncoder().encode(key).length > 128)
    throw new ApplicationError("invalid_input", "Idempotency-Key required", 400);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${user + ":" + key},740099))`);
  const row = (
    await tx.execute<{ id: string; fingerprint: string; response: unknown }>(
      sql`SELECT session_id::text AS id,fingerprint,response FROM interview_operations WHERE owner_id=${user} AND key=${key}`,
    )
  ).rows[0];
  if (!row) return null;
  if (row.fingerprint !== hash)
    throw new ApplicationError("idempotency_conflict", "Key was used for another operation", 409);
  return { id: row.id, response: row.response };
}
export async function priorOperation(
  tx: Transaction,
  user: string,
  key: string,
  hash: string,
): Promise<string | null> {
  return (await priorOperationRecord(tx, user, key, hash))?.id ?? null;
}
export async function saveOperation(
  tx: Transaction,
  user: string,
  key: string,
  hash: string,
  id: string,
  response?: unknown,
): Promise<void> {
  await tx.execute(
    sql`INSERT INTO interview_operations(owner_id,key,fingerprint,session_id,response) VALUES(${user},${key},${hash},${id}::uuid,${response === undefined ? null : JSON.stringify(response)}::jsonb)`,
  );
}
