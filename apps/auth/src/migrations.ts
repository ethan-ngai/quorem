import { readdir, readFile } from "node:fs/promises";
import type { Pool } from "pg";

export async function migrateAuth(database: Pool) {
  const directory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  if (!files.length) throw new Error("No auth SQL migrations found");
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(714901, 1)");
    const existing = await client.query(
      "SELECT to_regclass('quorem_auth.schema_migrations') AS ledger, to_regclass('quorem_auth.user') AS users",
    );
    if (!existing.rows[0].ledger && existing.rows[0].users) {
      throw new Error(
        "Existing preproduction auth schema requires python3 scripts/adopt-schema.py --service auth (see docs/implementation/database.md)",
      );
    }
    await client.query("CREATE SCHEMA IF NOT EXISTS quorem_auth");
    await client.query(
      "CREATE TABLE IF NOT EXISTS quorem_auth.schema_migrations(name text PRIMARY KEY)",
    );
    const applied = new Set(
      (
        await client.query<{ name: string }>("SELECT name FROM quorem_auth.schema_migrations")
      ).rows.map(({ name }) => name),
    );
    for (const name of applied) {
      if (!files.includes(name)) throw new Error(`Database has unavailable auth migration ${name}`);
    }
    for (const file of files) {
      if (applied.has(file)) continue;
      await client.query(await readFile(new URL(file, directory), "utf8"));
      await client.query("INSERT INTO quorem_auth.schema_migrations(name) VALUES($1)", [file]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
