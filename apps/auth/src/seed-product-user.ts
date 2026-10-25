/** @file seed-product-user.ts @description Operator-owned identity binding and grants. @module auth */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

/** Bind an immutable auth subject; email never joins identities. */
export async function seedProductUser(
  pool: Pool,
  input: {
    origin: string;
    subject: string;
    name: string;
    admin: boolean;
    source: string;
    reference: string;
  },
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,740179))", [
      `${input.origin}:${input.subject}`,
    ]);
    const binding = await client.query(
      "SELECT user_id FROM identity_bindings WHERE issuer=$1 AND subject=$2",
      [input.origin, input.subject],
    );
    const id: string = binding.rows[0]?.user_id ?? randomUUID();
    if (!binding.rowCount) {
      await client.query(
        "INSERT INTO users(id,participant_id,display_name) VALUES($1::text,$1::text::uuid,$2)",
        [id, input.name],
      );
      await client.query("INSERT INTO identity_bindings(issuer,subject,user_id) VALUES($1,$2,$3)", [
        input.origin,
        input.subject,
        id,
      ]);
    }
    await client.query("UPDATE users SET role=$2 WHERE id=$1", [
      id,
      input.admin ? "admin" : "user",
    ]);
    if (input.admin) {
      await client.query(
        "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'internal','internal',$3,$4,'Operator admin bootstrap') ON CONFLICT(user_id,feature,source,source_ref) DO NOTHING",
        [randomUUID(), id, input.reference, input.source],
      );
      await client.query(
        "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES($1,$2,$3,'seed:internal','internal','Operator admin bootstrap') ON CONFLICT DO NOTHING",
        [`${input.reference}:internal:${id}`, input.source, id],
      );
    }
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
