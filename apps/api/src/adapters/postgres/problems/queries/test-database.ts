/** @file test-database.ts @description Migrate the disposable catalog fixture before either runtime suite. @module problems */
import { fileURLToPath } from "node:url";
import { createNodePool } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
export default async function setup(): Promise<void> {
  const url = process.env.QUOREM_CATALOG_TEST_DATABASE_URL;
  if (!url) return;
  const parsed = new URL(url);
  if (
    parsed.pathname !== "/quorem_hono_catalog_test" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
  )
    throw new Error("Disposable catalog database required");
  const pool = createNodePool({
    connectionString: url,
    max: 1,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    onIdleError: (error) => {
      throw error;
    },
  });
  try {
    await migrate(
      pool,
      "product",
      fileURLToPath(new URL("../../../../../migrations/", import.meta.url)),
    );
  } finally {
    await pool.end();
  }
}
