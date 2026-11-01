/** @file seed-local.ts @description Explicit local fixture initialization. @module cli */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
import { createNodePool } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { seedCatalog } from "./seed.ts";
import { Client } from "pg";

/** Only the dedicated loopback development database is created automatically. */
export async function ensureLocalDatabase(connectionString: string): Promise<void> {
  const target = new URL(connectionString);
  if (target.pathname !== "/quorem_hono_dev") return;
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    target.hash ||
    [...target.searchParams.keys()].some((key) =>
      ["host", "hostaddr", "service"].includes(key.toLowerCase()),
    )
  )
    throw new Error("Local development database requires a loopback connection");
  target.pathname = "/postgres";
  const client = new Client({
    connectionString: target.href,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  try {
    await client.connect();
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname='quorem_hono_dev'");
    if (!result.rowCount) {
      try {
        await client.query("CREATE DATABASE quorem_hono_dev");
      } catch (error) {
        if ((error as { code?: string }).code !== "42P04") throw error;
      }
    }
  } finally {
    await client.end();
  }
}

if (import.meta.main)
  try {
    if (process.env.APP_ENV !== "local") throw new Error("Local environment required");
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    await ensureLocalDatabase(process.env.DATABASE_URL);
    const pool = createNodePool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    try {
      await migrate(pool, "product", resolve(root, "apps/api/migrations"));
      await seedCatalog(pool, true);
    } finally {
      await pool.end();
    }
  } catch {
    console.error("Local seed failed");
    process.exitCode = 1;
  }
