import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { migrate } from "@quorem/database/migrations";

export async function migrateAuth(database: Pool) {
  await migrate(database, "auth", fileURLToPath(new URL("../migrations/", import.meta.url)));
}
