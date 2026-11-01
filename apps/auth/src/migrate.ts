import { migrateAuth } from "./migrations.ts";
import { createNodeDatabase } from "./database.ts";

export async function migrate(env: NodeJS.ProcessEnv = process.env) {
  const { database } = createNodeDatabase(env);
  try {
    await migrateAuth(database);
  } finally {
    await database.end();
  }
}
if (import.meta.main) await migrate();
