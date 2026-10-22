import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

export async function migrateAuth(database: Pool) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    // IF NOT EXISTS still races in PostgreSQL catalogs; serialize all auth migrations.
    await client.query("SELECT pg_advisory_xact_lock(714901, 1)");
    for (const file of [
      "001_auth.sql",
      "002_username.sql",
      "003_passkey.sql",
      "004_email_registration.sql",
      "005_rate_limits.sql",
      "006_session_assurance.sql",
    ]) {
      await client.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
