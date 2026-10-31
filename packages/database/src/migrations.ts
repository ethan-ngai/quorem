import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

export type MigrationOwner = 'product' | 'auth';

export async function migrate(pool: Pool, owner: MigrationOwner, directory: string): Promise<void> {
  const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
  if (!files.length) throw new Error(`No ${owner} SQL migrations found`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(owner === 'auth' ? 'SELECT pg_advisory_xact_lock(714901, 1)' : 'SELECT pg_advisory_xact_lock(740010)');
    if (owner === 'auth') {
      const existing = await client.query("SELECT to_regclass('quorem_auth.schema_migrations') AS ledger, to_regclass('quorem_auth.user') AS users");
      if (!existing.rows[0].ledger && existing.rows[0].users) throw new Error('Existing auth schema has no migration ledger; use a fresh database or migrate it explicitly');
      await client.query('CREATE SCHEMA IF NOT EXISTS quorem_auth');
    }
    const ledger = owner === 'auth' ? 'quorem_auth.schema_migrations' : 'schema_migrations';
    await client.query(`CREATE TABLE IF NOT EXISTS ${ledger}(name text PRIMARY KEY)`);
    const applied = new Set<string>((await client.query(`SELECT name FROM ${ledger}`)).rows.map((row: {name: string}) => row.name));
    for (const name of applied) if (!files.includes(name)) throw new Error(`Database has unavailable ${owner} migration ${name}`);
    let missing = false;
    for (const file of files) {
      if (!applied.has(file)) missing = true;
      else if (missing) throw new Error(`${owner} migration history is not a contiguous prefix`);
    }
    for (const file of files) {
      if (applied.has(file)) continue;
      try { await client.query(await readFile(join(directory, file), 'utf8')); }
      catch (error) { throw new Error(`migration ${file} failed`, { cause: error }); }
      await client.query(`INSERT INTO ${ledger}(name) VALUES($1)`, [file]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
