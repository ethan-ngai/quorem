/** @file seed-local.ts @description Explicit local fixture initialization. @module cli */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
import { createNodePool } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { seedCatalog } from "./seed.ts";

if (import.meta.main)
  try {
    if (process.env.APP_ENV !== "local") throw new Error("Local environment required");
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
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
