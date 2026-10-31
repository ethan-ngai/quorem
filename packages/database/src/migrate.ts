/** @file migrate.ts @description PostgreSQL schema and migration ownership. @module database */
import { resolve } from "node:path";
import pg from "pg";
import { migrate, type MigrationOwner } from "./migrations.ts";

const [owner, directory] = process.argv.slice(2);
if ((owner !== "product" && owner !== "auth") || !directory || !process.env.DATABASE_URL) {
  throw new Error(
    "Usage: DATABASE_URL=<direct PostgreSQL URL> node src/migrate.ts <product|auth> <migration-directory>",
  );
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await migrate(pool, owner as MigrationOwner, resolve(directory));
} finally {
  await pool.end();
}
